// api/worker.js
import { Redis } from '@upstash/redis';
import { createClient } from '@libsql/client';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

const PROXY_SECRET = process.env.TIK_PROXY_SECRET;

// Initialize Turso client
const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
}

async function fetchProfileViaProxy(username) {
    const url = `https://tik-proxy.vercel.app/api/followback/${username}`;
    const response = await fetch(url, {
        headers: { 'x-api-key': PROXY_SECRET }
    });
    if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
    const data = await response.json();
    const userInfo = data?.data?.userInfo;
    if (!userInfo) throw new Error('Invalid response from proxy');
    return userInfo;
}

// Helper to insert a result into Turso
async function insertIntoTurso(mode, result) {
    const table = mode === 'followers' ? 'followers' : 'following';
    try {
        if (result.success) {
            await turso.execute({
                sql: `
                    INSERT INTO ${table} 
                    (username, unique_id, nickname, follower_count, following_count, heart_count, video_count, is_private, is_verified, avatar_url, success, error, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(username) DO UPDATE SET
                        unique_id = excluded.unique_id,
                        nickname = excluded.nickname,
                        follower_count = excluded.follower_count,
                        following_count = excluded.following_count,
                        heart_count = excluded.heart_count,
                        video_count = excluded.video_count,
                        is_private = excluded.is_private,
                        is_verified = excluded.is_verified,
                        avatar_url = excluded.avatar_url,
                        success = excluded.success,
                        error = excluded.error,
                        fetched_at = excluded.fetched_at
                `,
                args: [
                    result.username,
                    result.uniqueId || null,
                    result.nickname || null,
                    result.followerCount ?? null,
                    result.followingCount ?? null,
                    result.heartCount ?? null,
                    result.videoCount ?? null,
                    result.isPrivate ? 1 : 0,
                    result.isVerified ? 1 : 0,
                    result.avatarUrl || null,
                    1,
                    null,
                    result.timestamp
                ]
            });
        } else {
            await turso.execute({
                sql: `INSERT INTO ${table} (username, success, error, fetched_at) VALUES (?, ?, ?, ?)`,
                args: [result.username, 0, result.error, result.timestamp]
            });
        }
    } catch (err) {
        console.error(`[Turso] Failed to insert ${result.username} into ${table}:`, err.message);
        // Do not rethrow – we don't want to break the worker because of a DB error
    }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
        setCorsHeaders(res);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let job = await redis.lpop(QUEUE_KEY);
        if (!job) {
            setCorsHeaders(res);
            return res.status(200).json({ message: 'No jobs pending' });
        }

        // Skip corrupted entry
        if (typeof job === 'string' && (job === '[object Object]' || job.trim() === '[object Object]')) {
            console.warn('[worker] Skipping corrupted job entry');
            setCorsHeaders(res);
            return res.status(200).json({ message: 'Skipped corrupted job entry' });
        }

        // Parse batch: supports both legacy array and new { mode, usernames } object
        let mode = 'followers'; // default
        let usernames;
        if (typeof job === 'string') {
            try {
                const parsed = JSON.parse(job);
                if (Array.isArray(parsed)) {
                    // Legacy batch (just an array)
                    usernames = parsed;
                } else if (parsed && Array.isArray(parsed.usernames)) {
                    // New batch object
                    mode = parsed.mode || 'followers';
                    usernames = parsed.usernames;
                } else {
                    throw new Error('Invalid batch format');
                }
            } catch {
                // Legacy comma‑separated string
                if (job.includes(',')) {
                    usernames = job.split(',').map(u => u.trim());
                } else {
                    throw new Error('Job is not a valid array or object');
                }
            }
        } else {
            throw new Error('Job has unknown type');
        }

        console.log(`[worker] Processing batch of ${usernames.length} usernames (mode: ${mode})`);

        // Process all usernames concurrently
        const results = await Promise.all(usernames.map(async (username) => {
            try {
                const userDetail = await fetchProfileViaProxy(username);
                const stats = userDetail?.stats || {};
                const user = userDetail?.user || {};
                const avatarUrl = user.avatarThumb || user.avatarMedium || '';
                const result = {
                    username,
                    success: true,
                    followerCount: stats.followerCount,
                    followingCount: stats.followingCount,
                    heartCount: stats.heartCount,
                    videoCount: stats.videoCount,
                    nickname: user.nickname,
                    uniqueId: user.uniqueId,
                    isPrivate: user.privateAccount || false,
                    isVerified: user.verified || false,
                    avatarUrl: avatarUrl,
                    timestamp: new Date().toISOString(),
                };
                // Store in Redis (same as before)
                await redis.rpush(RESULTS_KEY, JSON.stringify(result));
                // Store in Turso (fire-and-forget, don't await? We await for data consistency but error handled inside)
                await insertIntoTurso(mode, result);
                return result;
            } catch (err) {
                const errorResult = {
                    username,
                    success: false,
                    error: err.message,
                    timestamp: new Date().toISOString(),
                };
                await redis.rpush(RESULTS_KEY, JSON.stringify(errorResult));
                await insertIntoTurso(mode, errorResult);
                return errorResult;
            }
        }));

        // Update status in Redis
        const statusRaw = await redis.get(STATUS_KEY);
        if (statusRaw) {
            const status = JSON.parse(statusRaw);
            status.completed += results.length;
            status.pending = Math.max(0, status.pending - 1);
            await redis.set(STATUS_KEY, JSON.stringify(status));
        }

        // Cleanup: when queue empty and all batches done, set TTL and delete queue key
        const queueLength = await redis.llen(QUEUE_KEY);
        if (queueLength === 0) {
            const finalStatusRaw = await redis.get(STATUS_KEY);
            if (finalStatusRaw) {
                const finalStatus = JSON.parse(finalStatusRaw);
                if (finalStatus.pending === 0 && finalStatus.completed === finalStatus.total) {
                    await redis.expire(STATUS_KEY, 3600);
                    await redis.expire(RESULTS_KEY, 3600);
                    await redis.del(QUEUE_KEY);
                    console.log(`[worker] Cleanup done (job completed)`);
                }
            }
        }

        console.log(`[worker] Completed batch, ${results.length} results stored`);
        setCorsHeaders(res);
        res.status(200).json({
            processed: usernames.length,
            resultsCount: results.length,
            message: `Processed ${usernames.length} usernames (${mode}) concurrently`
        });
    } catch (err) {
        console.error('[worker] Error:', err);
        setCorsHeaders(res);
        res.status(500).json({ error: err.message });
    }
}
