// pages/api/enqueue.js
import { Redis } from '@upstash/redis';

// Initialize Redis client from environment variables
const redis = Redis.fromEnv();
const BATCH_SIZE = 20; // Usernames per job
const QUEUE_KEY = 'tiktok:queue';
const STATUS_KEY = 'tiktok:status';

/**
 * A helper to log errors with more context
 */
function logError(context, error) {
  console.error(`[ENQUEUE ERROR] ${context}:`, {
    message: error.message,
    stack: error.stack,
    ...(error.cause && { cause: error.cause }),
  });
}

export default async function handler(req, res) {
  // Wrap everything in a try/catch to catch any unhandled exceptions
  try {
    // --- Request validation ---
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Log that we've started processing
    console.log('[ENQUEUE] Request received');

    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      console.warn('[ENQUEUE] Invalid request: missing or empty "usernames" array');
      return res.status(400).json({ error: 'usernames array is required and cannot be empty' });
    }

    console.log(`[ENQUEUE] Received ${usernames.length} usernames to process.`);

    // --- Initialize status in Redis ---
    const initialStatus = {
      total: usernames.length,
      pending: 0,
      completed: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    await redis.set(STATUS_KEY, JSON.stringify(initialStatus));
    console.log(`[ENQUEUE] Initialized status in Redis.`);

    // --- Split into batches and enqueue ---
    let pendingJobs = 0;
    for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
      const batch = usernames.slice(i, i + BATCH_SIZE);
      await redis.rpush(QUEUE_KEY, JSON.stringify(batch));
      pendingJobs++;
    }

    // --- Update pending job count ---
    const updatedStatus = { ...initialStatus, pending: pendingJobs };
    await redis.set(STATUS_KEY, JSON.stringify(updatedStatus));

    const responseBody = {
      message: `${pendingJobs} jobs enqueued`,
      totalUsernames: usernames.length,
    };
    console.log(`[ENQUEUE] Success: ${JSON.stringify(responseBody)}`);

    return res.status(202).json(responseBody);

  } catch (error) {
    // Log the error and send a 500 response
    logError('Handler execution failed', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
