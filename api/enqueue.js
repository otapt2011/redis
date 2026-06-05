import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BATCH_SIZE = 20;
const QUEUE_KEY = 'tiktok:queue';
const STATUS_KEY = 'tiktok:status';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'usernames array required' });
    }

    console.log(`[enqueue] Received ${usernames.length} usernames`);

    // Initialize status
    const initialStatus = {
      total: usernames.length,
      pending: 0,
      completed: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    await redis.set(STATUS_KEY, JSON.stringify(initialStatus));

    // Split into batches and push to queue
    let pendingJobs = 0;
    for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
      const batch = usernames.slice(i, i + BATCH_SIZE);
      await redis.rpush(QUEUE_KEY, JSON.stringify(batch));
      pendingJobs++;
    }

    // Update pending count
    const updatedStatus = { ...initialStatus, pending: pendingJobs };
    await redis.set(STATUS_KEY, JSON.stringify(updatedStatus));

    console.log(`[enqueue] Enqueued ${pendingJobs} jobs`);
    res.status(202).json({ message: `${pendingJobs} jobs enqueued`, totalUsernames: usernames.length });
  } catch (err) {
    console.error('[enqueue] Error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
