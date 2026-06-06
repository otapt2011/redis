// api/worker.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

const PROXY_SECRET = process.env.TIK_PROXY_SECRET;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function fetchProfileViaProxy(username) {
  const url = `https://tik-proxy.vercel.app/api/followback/${username}`;
  const response = await fetch(url, {
    headers: { 'x-api-key': PROXY_SECRET }
  });
  if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
  const data = await response.json();
  const userInfo = data?.data?.userInfo;
  if (!userInfo) throw new Error('Invalid response from proxy');
  return userInfo;
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
    // Pop a job from the queue
    let job = await redis.lpop(QUEUE_KEY);
    if (!job) {
      setCorsHeaders(res);
      return res.status(200).json({ message: 'No jobs pending' });
    }

    // Skip corrupted job entry
    if (typeof job === 'string' && (job === '[object Object]' || job.trim() === '[object Object]')) {
      console.warn('[worker] Skipping corrupted job entry');
      setCorsHeaders(res);
      return res.status(200).json({ message: 'Skipped corrupted job entry' });
    }

    let usernames;
    if (Array.isArray(job)) {
      usernames = job;
    } else if (typeof job === 'string') {
      try {
        const parsed = JSON.parse(job);
        if (Array.isArray(parsed)) {
          usernames = parsed;
        } else {
          throw new Error('Parsed JSON is not an array');
        }
      } catch {
        // Legacy fallback: comma-separated string
        if (job.includes(',')) {
          usernames = job.split(',').map(u => u.trim());
        } else {
          throw new Error('Job is not a valid array or comma-separated string');
        }
      }
    } else {
      throw new Error('Job has unknown type');
    }

    console.log(`[worker] Processing batch of ${usernames.length} usernames`);

    const results = [];
    for (const username of usernames) {
      try {
        const userDetail = await fetchProfileViaProxy(username);
        const stats = userDetail?.stats || {};
        const user = userDetail?.user || {};
        const avatarUrl = user.avatarThumb || user.avatarMedium || '';
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
          avatarUrl: avatarUrl,
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
      // Delay between usernames (200ms)
      await new Promise(r => setTimeout(r, 200));
    }

    // Store each result as a JSON string
    for (const result of results) {
      await redis.rpush(RESULTS_KEY, JSON.stringify(result));
    }

    // Update status
    const statusRaw = await redis.get(STATUS_KEY);
    if (statusRaw) {
      const status = JSON.parse(statusRaw);
      status.completed += results.length;
      status.pending = Math.max(0, status.pending - 1);
      await redis.set(STATUS_KEY, JSON.stringify(status));
    }

    // Cleanup: when queue empty and all batches done, set TTL and delete queue key
    const queueLength = await redis.llen(QUEUE_KEY);
    if (queueLength === 0) {
      const finalStatusRaw = await redis.get(STATUS_KEY);
      if (finalStatusRaw) {
        const finalStatus = JSON.parse(finalStatusRaw);
        if (finalStatus.pending === 0 && finalStatus.completed === finalStatus.total) {
          await redis.expire(STATUS_KEY, 3600);   // 1 hour
          await redis.expire(RESULTS_KEY, 3600);  // 1 hour
          await redis.del(QUEUE_KEY);
          console.log(`[worker] Cleanup: set TTL on status & results, deleted queue (job completed)`);
        }
      }
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
