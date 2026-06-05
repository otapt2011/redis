// pages/api/results.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

export default async function handler(req, res) {
  const statusRaw = await redis.get(STATUS_KEY);
  const status = statusRaw ? JSON.parse(statusRaw) : null;

  // Get first 1000 results (or use pagination)
  const resultsRaw = await redis.lrange(RESULTS_KEY, 0, 999);
  const results = resultsRaw.map(r => JSON.parse(r));

  res.status(200).json({ status, results, totalResults: results.length });
}
