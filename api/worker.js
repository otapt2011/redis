// api/worker.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

// Your proxy secret key (store as env var on Vercel)
const PROXY_SECRET = process.env.TIK_PROXY_SECRET;   // ← add to Vercel env

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
  // ... (CORS handling same as before) ...

  try {
    const job = await redis.lpop(QUEUE_KEY);
    if (!job) {
      setCorsHeaders(res);
      return res.status(200).json({ message: 'No jobs pending' });
    }

    let usernames = JSON.parse(job);
    if (!Array.isArray(usernames)) throw new Error('Job is not an array');

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
          isPrivate: user.privateAccount || false,
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
      // Small delay to respect rate limits (proxy may have its own limits)
      await new Promise(r => setTimeout(r, 200));
    }

    // Store results and update status (same as before)
    for (const result of results) {
      await redis.rpush(RESULTS_KEY, JSON.stringify(result));
    }

    // ... update status counters ...

    setCorsHeaders(res);
    res.status(200).json({ processed: usernames.length });
  } catch (err) {
    // ... error handling ...
  }
}
