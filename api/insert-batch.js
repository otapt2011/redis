// api/insert-batch.js – Full Turso version
import { createClient } from '@libsql/client';

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

const TABLE_NAME = 'followers'; // change to 'following' if needed

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { batch } = req.body;
        if (!Array.isArray(batch) || batch.length === 0) {
            return res.status(400).json({ error: 'batch array required' });
        }

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
        if (statements.length) {
            await turso.batch(statements);
        }
        return res.status(200).json({ inserted: statements.length });
    } catch (err) {
        console.error('Insert batch error:', err);
        return res.status(500).json({ error: err.message });
    }
}
