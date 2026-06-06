// api/migrate.js
// Processes migration in chunks to stay within Vercel's execution limits.
// Call with ?cursor=0&limit=500 to start or continue a migration.

import { Redis } from '@upstash/redis';
import { createClient } from '@libsql/client';

const redis = Redis.fromEnv();
const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const RESULTS_KEY = 'tiktok:results';
const TABLE_NAME = 'followers'; // or 'following'

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }
    setCorsHeaders(res);
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { cursor = 0, limit = 500 } = req.query;
    const start = parseInt(cursor, 10);
    const batchSize = Math.min(parseInt(limit, 10), 1000);

    try {
        // 1. Get total length for progress tracking
        const total = await redis.llen(RESULTS_KEY);
        if (total === 0) {
            return res.status(200).json({ message: 'No results to migrate', total: 0 });
        }

        // 2. Fetch only one chunk from Redis
        const end = start + batchSize - 1;
        const resultsRaw = await redis.lrange(RESULTS_KEY, start, end);

        // 3. Process and insert the chunk into Turso
        let inserted = 0;
        let errors = 0;
        const insertStatements = [];

        for (const item of resultsRaw) {
            let result;
            if (typeof item === 'string') {
                try { result = JSON.parse(item); } catch (e) { errors++; continue; }
            } else if (typeof item === 'object' && item !== null) {
                result = item;
            } else {
                errors++;
                continue;
            }

            if (result.success) {
                insertStatements.push({
                    sql: `
                        INSERT INTO ${TABLE_NAME} 
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
                        result.timestamp || new Date().toISOString()
                    ]
                });
            } else {
                insertStatements.push({
                    sql: `INSERT INTO ${TABLE_NAME} (username, success, error, fetched_at) VALUES (?, ?, ?, ?)`,
                    args: [result.username, 0, result.error, result.timestamp || new Date().toISOString()]
                });
            }
            inserted++;
        }

        // 4. Execute batch insert for the chunk
        if (insertStatements.length > 0) {
            await turso.batch(insertStatements);
        }

        // 5. Determine if there's more data to process
        const nextCursor = end + 1 >= total ? null : end + 1;
        const isComplete = nextCursor === null;

        return res.status(200).json({
            message: isComplete ? 'Migration completed' : 'Chunk processed',
            total,
            processed: end + 1,
            inserted,
            errors,
            nextCursor,
            isComplete,
            table: TABLE_NAME,
            batchSize
        });
    } catch (err) {
        console.error('Migration error:', err);
        return res.status(500).json({ error: err.message });
    }
}
