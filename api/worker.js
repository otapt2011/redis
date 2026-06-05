// api/worker.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

// Your proxy secret key (must be set in Vercel environment variables)
const PROXY_SECRET = process.env.TIK_PROXY_SECRET;

// Helper to set CORS headers on every response
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Fetch profile stats using your tik-proxy (instead of direct scraping)
async function fetchProfileViaProxy(username) {
  const url = `https://tik-proxy.vercel.app/api/followback/${username}`;
  const response = await fetch(url, {
    headers: { 'x-api-key': PROXY_SECRET }
  });
  if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
  const data = await response.json();
  // The proxy returns the same structure as before
  const userInfo = data?.data?.userInfo;
  if (!userInfo) throw new Error('Invalid response from proxy');
  return userInfo;
}

export default async function handler(req, res) {
  // Handle preflight OPTIONS request (CORS)
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  // Allow only GET (manual trigger) and POST (for cron jobs)
  if (req.method !== 'GET' && req.method !== 'POST') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Pop one job from the queue
    const job = await redis.lpop(QUEUE_KEY);
    if (!job) {
      setCorsHeaders(res);
      return res.status(200).json({ message: 'No jobs pending' });
    }

    let usernames;
    try {
      usernames = JSON.parse(job);
      if (!Array.isArray(usernames)) throw new Error('Job is not an array');
    } catch (parseErr) {
      console.error(`[worker] Failed to parse job: ${job}`, parseErr);
      setCorsHeaders(res);
      return res.status(200).json({ error: 'Skipped malformed job', raw: job });
    }

    console.log(`[worker] Processing batch of ${usernames.length} usernames`);

    const results = [];
    for (const username of usernames) {
      try {
        const userDetail = await fetchProfileViaProxy(username);
        const stats = userDetail?.stats || {};
        const user = userDetail?.user || {};
        results.push({
          username,
          success: true,
          followerCount: stats.followerCount,
          followingCount: stats.followingCount,
          heartCount: stats.heartCount,
          videoCount: stats.videoCount,
          nickname: user.nickname,
          uniqueId: user.uniqueId,
          isPrivate: user.privateAccount || false,
          isVerified: user.verified || false,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        results.push({
          username,
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
      // Small delay to respect rate limits (adjust as needed)
      await new Promise(r => setTimeout(r, 200));
    }

    // Store results in Redis (append each as a JSON string)
    for (const result of results) {
      await redis.rpush(RESULTS_KEY, JSON.stringify(result));
    }

    // Update status counters
    const statusRaw = await redis.get(STATUS_KEY);
    if (statusRaw) {
      const status = JSON.parse(statusRaw);
      status.completed += results.length;
      status.pending = Math.max(0, status.pending - 1);
      await redis.set(STATUS_KEY, JSON.stringify(status));
    }

    console.log(`[worker] Completed batch, ${results.length} results stored`);
    setCorsHeaders(res);
    res.status(200).json({
      processed: usernames.length,
      resultsCount: results.length,
      message: `Processed ${usernames.length} usernames`
    });
  } catch (err) {
    console.error('[worker] Error:', err);
    setCorsHeaders(res);
    res.status(500).json({ error: err.message });
  }
}
