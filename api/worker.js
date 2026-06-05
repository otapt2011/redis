// api/worker.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function fetchUserDetail(username) {
  const url = `https://www.tiktok.com/@${username}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await response.text();
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error('Profile not found');
  const data = JSON.parse(match[1]);
  return data['__DEFAULT_SCOPE__']['webapp.user-detail'];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const job = await redis.lpop(QUEUE_KEY);
    if (!job) {
      setCorsHeaders(res);
      return res.status(200).json({ message: 'No jobs pending' });
    }

    // ✅ Parse the job (it should be a JSON string of an array)
    let usernames;
    try {
      usernames = JSON.parse(job);
      if (!Array.isArray(usernames)) throw new Error('Job is not an array');
    } catch (parseErr) {
      console.error(`[worker] Failed to parse job: ${job}`, parseErr);
      // If malformed, skip this job and continue
      setCorsHeaders(res);
      return res.status(200).json({ error: 'Skipped malformed job', raw: job });
    }

    console.log(`[worker] Processing batch of ${usernames.length} usernames`);

    const results = [];
    for (const username of usernames) {
      try {
        const userDetail = await fetchUserDetail(username);
        const stats = userDetail?.userInfo?.stats || {};
        const user = userDetail?.userInfo?.user || {};
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
      await new Promise(r => setTimeout(r, 200));
    }

    for (const result of results) {
      await redis.rpush(RESULTS_KEY, JSON.stringify(result));
    }

    const statusRaw = await redis.get(STATUS_KEY);
    if (statusRaw) {
      const status = JSON.parse(statusRaw);
      status.completed += results.length;
      status.pending = Math.max(0, status.pending - 1);
      await redis.set(STATUS_KEY, JSON.stringify(status));
    }

    console.log(`[worker] Completed batch, ${results.length} results stored`);
    setCorsHeaders(res);
    res.status(200).json({ processed: usernames.length, resultsCount: results.length });
  } catch (err) {
    console.error('[worker] Error:', err);
    setCorsHeaders(res);
    res.status(500).json({ error: err.message });
  }
}
