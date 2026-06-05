import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

export default async function handler(req, res) {
  try {
    const statusRaw = await redis.get(STATUS_KEY);
    const status = statusRaw ? JSON.parse(statusRaw) : null;

    // Get all results (up to 10,000 – adjust as needed)
    const resultsRaw = await redis.lrange(RESULTS_KEY, 0, 9999);
    const results = resultsRaw.map(r => JSON.parse(r));

    res.status(200).json({ status, results, totalResults: results.length });
  } catch (err) {
    console.error('[results] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
