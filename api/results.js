// api/results.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const statusRaw = await redis.get(STATUS_KEY);
    const status = statusRaw ? JSON.parse(statusRaw) : null;

    const resultsRaw = await redis.lrange(RESULTS_KEY, 0, 9999);
    const results = [];

    for (const item of resultsRaw) {
      // If item is already an object (e.g., stored incorrectly)
      if (typeof item === 'object' && item !== null) {
        results.push(item);
      }
      // If item is a string, try to parse it
      else if (typeof item === 'string') {
        try {
          results.push(JSON.parse(item));
        } catch (e) {
          console.warn(`Skipping malformed result string: ${item.substring(0, 100)}`);
          results.push({ error: 'Malformed JSON', raw: item });
        }
      }
      // Unknown type
      else {
        results.push({ error: 'Unknown result type', raw: item });
      }
    }

    setCorsHeaders(res);
    res.status(200).json({ status, results, totalResults: results.length });
  } catch (err) {
    console.error('[results] Error:', err);
    setCorsHeaders(res);
    res.status(500).json({ error: err.message });
  }
}
