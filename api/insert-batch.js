// api/insert-batch.js – Safe Turso version with full error reporting
import { createClient } from '@libsql/client';

// CORS headers – set as early as possible
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
    // Set CORS headers first thing
    Object.entries(corsHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
    });

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only POST allowed
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Check environment variables
        if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
            throw new Error('Missing Turso environment variables');
        }

        // 2. Initialize Turso client
        const turso = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        // 3. Test connection (optional but helpful)
        try {
            await turso.execute('SELECT 1');
        } catch (connErr) {
            throw new Error(`Turso connection failed: ${connErr.message}`);
        }

        // 4. Parse batch
        const { batch } = req.body;
        if (!Array.isArray(batch) || batch.length === 0) {
            return res.status(400).json({ error: 'batch array required' });
        }

        // 5. Prepare statements
        const TABLE_NAME = 'followers'; // or 'following'
        const statements = [];

        for (const result of batch) {
            if (result.success) {
                statements.push({
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
                statements.push({
                    sql: `INSERT INTO ${TABLE_NAME} (username, success, error, fetched_at) VALUES (?, ?, ?, ?)`,
                    args: [result.username, 0, result.error, result.timestamp || new Date().toISOString()]
                });
            }
        }

        // 6. Execute batch
        if (statements.length) {
            await turso.batch(statements);
        }

        return res.status(200).json({ inserted: statements.length });
    } catch (err) {
        console.error('Insert batch error:', err);
        // Return error as JSON (CORS headers already set)
        return res.status(500).json({ error: err.message });
    }
}
