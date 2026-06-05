// pages/api/enqueue.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BATCH_SIZE = 20;        // usernames per job
const QUEUE_KEY = 'tiktok:queue';
const STATUS_KEY = 'tiktok:status';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { usernames } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'usernames array required' });
  }

  // Initialize status counters
  await redis.set(STATUS_KEY, JSON.stringify({
    total: usernames.length,
    pending: 0,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
  }));

  // Split into batches and push each batch as a job
  let pendingCount = 0;
  for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
    const batch = usernames.slice(i, i + BATCH_SIZE);
    await redis.rpush(QUEUE_KEY, JSON.stringify(batch));
    pendingCount++;
  }

  // Update pending count
  const status = await redis.get(STATUS_KEY);
  if (status) {
    const parsed = JSON.parse(status);
    parsed.pending = pendingCount;
    await redis.set(STATUS_KEY, JSON.stringify(parsed));
  }

  res.status(202).json({ message: `${pendingCount} jobs enqueued`, totalUsernames: usernames.length });
}
