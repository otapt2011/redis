// api/migrate.js
// Temporary endpoint to migrate existing Redis results into Turso.
// After migration, DELETE THIS FILE or keep it but be aware it is publicly accessible.

import { Redis } from '@upstash/redis';
import { createClient } from '@libsql/client';

const redis = Redis.fromEnv();

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const RESULTS_KEY = 'tiktok:results';
const TABLE_NAME = 'followers';   // Change to 'following' if needed

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
    // Handle preflight
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }

    setCorsHeaders(res);

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Read all results from Redis
        const resultsRaw = await redis.lrange(RESULTS_KEY, 0, -1);
        if (!resultsRaw.length) {
            return res.status(200).json({ message: 'No results to migrate', count: 0 });
        }

        let inserted = 0;
        let errors = 0;

        for (const item of resultsRaw) {
            let result;
            // Parse the stored value
            if (typeof item === 'string') {
                try {
                    result = JSON.parse(item);
                } catch (e) {
                    console.warn(`Skipping invalid JSON: ${item.substring(0, 100)}`);
                    continue;
                }
            } else if (typeof item === 'object' && item !== null) {
                result = item;
            } else {
                continue;
            }

            try {
                if (result.success) {
                    await turso.execute({
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
                    await turso.execute({
                        sql: `INSERT INTO ${TABLE_NAME} (username, success, error, fetched_at) VALUES (?, ?, ?, ?)`,
                        args: [result.username, 0, result.error, result.timestamp || new Date().toISOString()]
                    });
                }
                inserted++;
            } catch (err) {
                console.error(`Failed to insert ${result.username}:`, err.message);
                errors++;
            }
        }

        return res.status(200).json({
            message: 'Migration completed',
            total: resultsRaw.length,
            inserted,
            errors,
            table: TABLE_NAME
        });
    } catch (err) {
        console.error('Migration error:', err);
        return res.status(500).json({ error: err.message });
    }
}
