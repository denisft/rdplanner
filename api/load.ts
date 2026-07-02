// GET /api/load?id=... — прочитать опубликованный план для просмотра коллегой.
// Возвращает { version, data, updatedAt } или 404, если плана нет.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const id = req.query?.id;
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' });
    return;
  }
  try {
    const record = await redis.get(`plan:${id}`);
    if (!record) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    // Всегда свежие данные — ссылка постоянная, контент меняется.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(record);
  } catch (err) {
    console.error('load failed', err);
    res.status(500).json({ error: 'Load failed' });
  }
}
