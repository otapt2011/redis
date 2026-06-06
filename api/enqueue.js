// api/enqueue.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BATCH_SIZE = 20;   // can be changed or read from request
const QUEUE_KEY = 'tiktok:queue';
const STATUS_KEY = 'tiktok:status';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        setCorsHeaders(res);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let { usernames, mode } = req.body;
        if (!Array.isArray(usernames) || usernames.length === 0) {
            setCorsHeaders(res);
            return res.status(400).json({ error: 'usernames array required' });
        }
        mode = mode || 'followers';   // default to followers
        usernames = usernames.filter(u => typeof u === 'string').map(u => u.trim());
        if (usernames.length === 0) {
            setCorsHeaders(res);
            return res.status(400).json({ error: 'no valid usernames' });
        }

        const initialStatus = {
            total: usernames.length,
            pending: 0,
            completed: 0,
            startedAt: Date.now(),
        };
        await redis.set(STATUS_KEY, JSON.stringify(initialStatus));

        let pendingJobs = 0;
        for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
            const batch = usernames.slice(i, i + BATCH_SIZE);
            // Store batch as object with mode
            const batchObject = { mode, usernames: batch };
            await redis.rpush(QUEUE_KEY, JSON.stringify(batchObject));
            pendingJobs++;
        }

        const updatedStatus = { ...initialStatus, pending: pendingJobs };
        await redis.set(STATUS_KEY, JSON.stringify(updatedStatus));

        setCorsHeaders(res);
        res.status(202).json({ message: `${pendingJobs} jobs enqueued`, totalUsernames: usernames.length, mode });
    } catch (err) {
        console.error('[enqueue] Error:', err);
        setCorsHeaders(res);
        res.status(500).json({ error: err.message });
    }
}
