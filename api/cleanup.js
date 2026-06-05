// api/cleanup.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';
const QUEUE_KEY = 'tiktok:queue';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

  setCorsHeaders(res);

  try {
    await redis.del(RESULTS_KEY);
    await redis.del(STATUS_KEY);
    await redis.del(QUEUE_KEY);
    res.status(200).json({ cleaned: true, message: 'All Redis keys deleted' });
  } catch (err) {
    console.error('[cleanup] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
