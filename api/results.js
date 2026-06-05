// api/results.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';
const QUEUE_KEY = 'tiktok:queue';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  setCorsHeaders(res);

  // DELETE: clean all TikTok-related keys
  if (req.method === 'DELETE') {
    try {
      await redis.del(RESULTS_KEY);
      await redis.del(STATUS_KEY);
      await redis.del(QUEUE_KEY);
      return res.status(200).json({ cleaned: true, message: 'All TikTok data cleared' });
    } catch (err) {
      console.error('[results DELETE] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Only GET is allowed after this
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const statusRaw = await redis.get(STATUS_KEY);
    const status = statusRaw ? JSON.parse(statusRaw) : null;

    const resultsRaw = await redis.lrange(RESULTS_KEY, 0, 9999);
    const results = [];

    for (const item of resultsRaw) {
      // Skip corrupted entries like "[object Object]"
      if (typeof item === 'string' && (item === '[object Object]' || item.trim() === '[object Object]')) {
        console.warn('Skipping corrupted entry:', item);
        continue;
      }
      // If item is already an object (rare, but possible)
      if (typeof item === 'object' && item !== null) {
        results.push(item);
      }
      // If item is a proper JSON string
      else if (typeof item === 'string') {
        try {
          results.push(JSON.parse(item));
        } catch (e) {
          console.warn(`Skipping malformed result string: ${item.substring(0, 100)}`);
          // Don't push an error object – just skip
        }
      }
      // Unknown type
      else {
        console.warn('Unknown result type:', item);
      }
    }

    res.status(200).json({ status, results, totalResults: results.length });
  } catch (err) {
    console.error('[results] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
