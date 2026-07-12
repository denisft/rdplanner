// POST /api/save — сохранить план в общее хранилище (Upstash Redis).
// Тело: { id?, editKey?, data }. Ссылка для чтения содержит только id;
// перезапись существующего плана требует editKey — секрет, который выдаётся
// при создании и хранится только у автора. Ответ: { id, editKey? } —
// editKey присылается при создании и при миграции планов, сохранённых
// до появления секретов (первый, кто перезапишет такой план, забирает его).
import {
  clientIp,
  parseBody,
  PLAN_TTL_SECONDS,
  rateLimitOk,
  redis,
  sha256,
  type ApiRequest,
  type ApiResponse,
  type PlanRecord,
} from './_lib';
import {
  EDIT_KEY_RE,
  MAX_PLAN_BYTES,
  PLAN_ID_RE,
  planSizeBytes,
  validatePlanData,
} from '../src/share/planGuards';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    if (!(await rateLimitOk(`save:${clientIp(req)}`, 30, 600))) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const { id, editKey, data } = parseBody(req);

    const invalid = validatePlanData(data);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    if (planSizeBytes(data) > MAX_PLAN_BYTES) {
      res.status(413).json({ error: 'Plan too large' });
      return;
    }

    const requestedId =
      typeof id === 'string' && PLAN_ID_RE.test(id) ? id : null;
    const suppliedKey =
      typeof editKey === 'string' && EDIT_KEY_RE.test(editKey)
        ? editKey
        : null;

    const planId = requestedId ?? crypto.randomUUID();
    const existing = requestedId
      ? await redis.get<PlanRecord>(`plan:${planId}`)
      : null;

    if (existing?.editKeyHash) {
      if (!suppliedKey || sha256(suppliedKey) !== existing.editKeyHash) {
        res.status(403).json({ error: 'Wrong edit key' });
        return;
      }
    }

    // Новый план или план без секрета — выдаём секрет владельцу.
    const issuedKey = existing?.editKeyHash ? null : crypto.randomUUID();
    const editKeyHash = existing?.editKeyHash ?? sha256(issuedKey!);

    const record: PlanRecord = {
      version: 1,
      data,
      updatedAt: Date.now(),
      editKeyHash,
    };
    await redis.set(`plan:${planId}`, record, { ex: PLAN_TTL_SECONDS });

    res
      .status(200)
      .json(issuedKey ? { id: planId, editKey: issuedKey } : { id: planId });
  } catch (err) {
    console.error('save failed', err);
    res.status(500).json({ error: 'Save failed' });
  }
}
