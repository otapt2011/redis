// pages/api/worker.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

// Reuse your existing fetchUserDetail logic (from the Vercel handler)
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
  // Only allow internal cron (optional: check a secret header)
  // For Vercel Cron, you can set a secret and verify it.

  // Pop one job from the queue
  const job = await redis.lpop(QUEUE_KEY);
  if (!job) {
    return res.status(200).json({ message: 'No jobs pending' });
  }

  const usernames = JSON.parse(job);
  const results = [];

  for (const username of usernames) {
    try {
      const userDetail = await fetchUserDetail(username);
      const stats = userDetail?.userInfo?.stats || {};
      results.push({
        username,
        success: true,
        followerCount: stats.followerCount,
        followingCount: stats.followingCount,
        heartCount: stats.heartCount,
        videoCount: stats.videoCount,
        nickname: userDetail?.userInfo?.user?.nickname,
        isPrivate: userDetail?.userInfo?.user?.privateAccount || false,
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
    // Small delay to avoid hitting rate limit too hard
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Store results (append to a Redis list or a hash)
  for (const result of results) {
    await redis.rpush(RESULTS_KEY, JSON.stringify(result));
  }

  // Update status counters
  const statusRaw = await redis.get(STATUS_KEY);
  if (statusRaw) {
    const status = JSON.parse(statusRaw);
    status.completed += usernames.length;
    status.pending -= 1;
    await redis.set(STATUS_KEY, JSON.stringify(status));
  }

  res.status(200).json({ processed: usernames.length, resultsCount: results.length });
}
