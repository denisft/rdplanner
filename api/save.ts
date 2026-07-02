// POST /api/save — сохранить план в общее хранилище (Upstash Redis).
// Тело: { id?: string, data: AppData }. Если id передан — перезаписывает тот же
// план (постоянная ссылка). Если нет — генерирует новый. Возвращает { id }.
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id, data } = body ?? {};

    if (!data || !Array.isArray(data.employees) || !Array.isArray(data.tasks)) {
      res.status(400).json({ error: 'Invalid plan data' });
      return;
    }

    const planId =
      typeof id === 'string' && ID_RE.test(id) ? id : crypto.randomUUID();

    await redis.set(`plan:${planId}`, {
      version: 1,
      data,
      updatedAt: Date.now(),
    });

    res.status(200).json({ id: planId });
  } catch (err) {
    console.error('save failed', err);
    res.status(500).json({ error: 'Save failed' });
  }
}
