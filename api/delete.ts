// POST /api/delete — отозвать опубликованную ссылку: удалить план с сервера.
// Тело: { id, editKey }. Планы, созданные до появления editKey, удаляются
// без секрета — это строго безопаснее прежнего положения, когда ссылка
// на чтение давала полную запись. Идемпотентно: нет плана — тоже ok.
import {
  clientIp,
  parseBody,
  rateLimitOk,
  redis,
  sha256,
  type ApiRequest,
  type ApiResponse,
  type PlanRecord,
} from './_lib';
import { PLAN_ID_RE } from '../src/share/planGuards';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    if (!(await rateLimitOk(`del:${clientIp(req)}`, 30, 600))) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const { id, editKey } = parseBody(req);
    if (typeof id !== 'string' || !PLAN_ID_RE.test(id)) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    const record = await redis.get<PlanRecord>(`plan:${id}`);
    if (record?.editKeyHash) {
      if (typeof editKey !== 'string' || sha256(editKey) !== record.editKeyHash) {
        res.status(403).json({ error: 'Wrong edit key' });
        return;
      }
    }
    if (record) await redis.del(`plan:${id}`);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete failed', err);
    res.status(500).json({ error: 'Delete failed' });
  }
}
