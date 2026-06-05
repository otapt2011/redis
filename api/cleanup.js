// api/cleanup.js
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // optional authentication (e.g., require a secret key)
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CLEANUP_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const statusKey = 'tiktok:status';
  const statusRaw = await redis.get(statusKey);
  if (!statusRaw) {
    return res.status(200).json({ message: 'No active job' });
  }

  const status = JSON.parse(statusRaw);
  const now = Date.now();
  const jobAgeHours = (now - status.startedAt) / (1000 * 3600);

  if (status.pending === 0 && status.completed === status.total && jobAgeHours > 1) {
    await redis.del(statusKey);
    await redis.del('tiktok:results');
    await redis.del('tiktok:queue');
    return res.status(200).json({ cleaned: true, jobAgeHours });
  } else {
    return res.status(200).json({ cleaned: false, reason: 'job not finished or too young' });
  }
}
