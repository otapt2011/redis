// api/enqueue.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BATCH_SIZE = 20;               // usernames per job
const QUEUE_KEY = 'tiktok:queue';
const STATUS_KEY = 'tiktok:status';

// Helper to set CORS headers on every response
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // or your specific frontend URL
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');   // 24 hours
}

export default async function handler(req, res) {
  // Handle preflight OPTIONS request (CORS)
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  // Only allow POST for the main logic
  if (req.method !== 'POST') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      setCorsHeaders(res);
      return res.status(400).json({ error: 'usernames array required and cannot be empty' });
    }

    console.log(`[enqueue] Received ${usernames.length} usernames`);

    // Initialize status in Redis
    const initialStatus = {
      total: usernames.length,
      pending: 0,
      completed: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    await redis.set(STATUS_KEY, JSON.stringify(initialStatus));

    // Split into batches and push each batch as a job to the Redis queue
    let pendingJobs = 0;
    for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
      const batch = usernames.slice(i, i + BATCH_SIZE);
      await redis.rpush(QUEUE_KEY, JSON.stringify(batch));
      pendingJobs++;
    }

    // Update the pending job count in the status
    const updatedStatus = { ...initialStatus, pending: pendingJobs };
    await redis.set(STATUS_KEY, JSON.stringify(updatedStatus));

    console.log(`[enqueue] Enqueued ${pendingJobs} jobs (${usernames.length} usernames total)`);

    setCorsHeaders(res);
    res.status(202).json({
      message: `${pendingJobs} jobs enqueued`,
      totalUsernames: usernames.length,
    });
  } catch (err) {
    console.error('[enqueue] Error:', err);
    setCorsHeaders(res);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message,
    });
  }
}
