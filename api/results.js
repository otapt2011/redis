// api/results.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

// Helper function to set CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or your frontend URL
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');   // Cache preflight for 24 hours
}

export default async function handler(req, res) {
  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  // Only allow GET for retrieving results
  if (req.method !== 'GET') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    // Fetch status and results from Redis
    const statusRaw = await redis.get(STATUS_KEY);
    const status = statusRaw ? JSON.parse(statusRaw) : null;

    // Get all stored results (up to 10,000 entries)
    const resultsRaw = await redis.lrange(RESULTS_KEY, 0, 9999);
    const results = resultsRaw.map(r => JSON.parse(r));

    // Send the response with CORS headers
    setCorsHeaders(res);
    res.status(200).json({ 
      status, 
      results, 
      totalResults: results.length 
    });
  } catch (err) {
    console.error('[results] Error:', err);
    setCorsHeaders(res);
    res.status(500).json({ error: err.message });
  }
}
