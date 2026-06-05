import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const QUEUE_KEY = 'tiktok:queue';
const RESULTS_KEY = 'tiktok:results';
const STATUS_KEY = 'tiktok:status';

// Fetch a single TikTok profile (scraping)
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
  try {
    // Pop one job from the queue
    const job = await redis.lpop(QUEUE_KEY);
    if (!job) {
      return res.status(200).json({ message: 'No jobs pending' });
    }

    const usernames = JSON.parse(job);
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
      // Delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    // Store results in Redis
    for (const result of results) {
      await redis.rpush(RESULTS_KEY, JSON.stringify(result));
    }

    // Update status counters
    const statusRaw = await redis.get(STATUS_KEY);
    if (statusRaw) {
      const status = JSON.parse(statusRaw);
      status.completed += results.length;
      status.pending -= 1;
      await redis.set(STATUS_KEY, JSON.stringify(status));
    }

    console.log(`[worker] Completed batch, ${results.length} results stored`);
    res.status(200).json({ processed: usernames.length, resultsCount: results.length });
  } catch (err) {
    console.error('[worker] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
