// GET /api/load?id=... — прочитать опубликованный план для просмотра коллегой.
// Возвращает { version, data, updatedAt } — без editKeyHash, чтобы секрет
// владельца не утекал читателям. 404, если плана нет или он истёк.
import {
  clientIp,
  PLAN_TTL_SECONDS,
  rateLimitOk,
  redis,
  type ApiRequest,
  type ApiResponse,
  type PlanRecord,
} from './_lib.js';
import { PLAN_ID_RE } from '../src/share/planGuards.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const id = req.query?.id;
  if (!id || typeof id !== 'string' || !PLAN_ID_RE.test(id)) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }
  try {
    if (!(await rateLimitOk(`load:${clientIp(req)}`, 120, 60))) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const record = await redis.get<PlanRecord>(`plan:${id}`);
    if (!record) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    // Живая ссылка не истекает: каждое чтение продлевает срок хранения.
    await redis.expire(`plan:${id}`, PLAN_TTL_SECONDS);

    // Всегда свежие данные — ссылка постоянная, контент меняется.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      version: record.version,
      data: record.data,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    console.error('load failed', err);
    res.status(500).json({ error: 'Load failed' });
  }
}
