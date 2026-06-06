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
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  setCorsHeaders(res);

  // DELETE handler
  if (req.method === 'DELETE') {
    try {
      await redis.del(RESULTS_KEY);
      await redis.del(STATUS_KEY);
      await redis.del(QUEUE_KEY);
      return res.status(200).json({ cleaned: true });
    } catch (err) {
      console.error('DELETE error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // GET handler – never throw, always return JSON
  try {
    let status = null;
    try {
      const statusRaw = await redis.get(STATUS_KEY);
      const queueLength = await redis.llen(QUEUE_KEY);
      if (statusRaw) {
        status = JSON.parse(statusRaw);
      }
    } catch (err) {
      console.error('Failed to parse status:', err);
      status = { error: 'Corrupted status' };
    }

    let resultsRaw = [];
    try {
      resultsRaw = await redis.lrange(RESULTS_KEY, 0, 9999);
    } catch (err) {
      console.error('Failed to read results list:', err);
    }

    const results = [];
    for (const item of resultsRaw) {
      // Skip utterly corrupted entries
      if (item === '[object Object]' || (typeof item === 'string' && item.trim() === '[object Object]')) {
        continue;
      }
      if (typeof item === 'object' && item !== null) {
        results.push(item);
        continue;
      }
      if (typeof item === 'string') {
        try {
          results.push(JSON.parse(item));
        } catch (e) {
          console.warn(`Skipping invalid JSON: ${item.substring(0, 100)}`);
        }
      }
    }

    return res.status(200).json({ status, results, totalResults: results.length, queueLength });
  } catch (err) {
    console.error('Unhandled error in results handler:', err);
    // Return a safe fallback, never a 500
    return res.status(200).json({ status: null, results: [], totalResults: 0, error: err.message });
  }
}
