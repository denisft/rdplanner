// Общий код serverless-функций шаринга: клиент Redis, rate limiting,
// хэш секрета владельца. Файлы на "_" Vercel не публикует как эндпоинты.
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token:
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

// Год без обращений — план истекает. Каждое сохранение и чтение продлевает
// срок, так что живые ссылки постоянны, а брошенные не копятся вечно.
export const PLAN_TTL_SECONDS = 365 * 24 * 60 * 60;

// Минимальные типы запроса/ответа Vercel — ровно то, что используют хендлеры,
// чтобы не тащить @vercel/node в зависимости ради пары сигнатур.
export type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
  headers?: Record<string, unknown>;
};

export type ApiResponse = {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): void;
  json(payload: unknown): void;
};

/** Тело POST-запроса после парсинга: поля проверяются по факту в хендлерах. */
export function parseBody(req: ApiRequest): Record<string, unknown> {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return (body ?? {}) as Record<string, unknown>;
}

/** Запись плана в Redis. editKeyHash нет у планов, созданных до секретов. */
export type PlanRecord = {
  version: number;
  data: unknown;
  updatedAt: number;
  editKeyHash?: string;
};

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** IP клиента за прокси Vercel — ключ для rate limiting. */
export function clientIp(req: ApiRequest): string {
  const fwd = req.headers?.['x-forwarded-for'];
  const first = typeof fwd === 'string' ? fwd.split(',')[0].trim() : '';
  return first || 'unknown';
}

// Rate limiting фиксированным окном (INCR + EXPIRE). Точность sliding window
// не нужна: защищаемся от злоупотреблений, а не от честных пользователей.
export async function rateLimitOk(
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const key = `rl:${bucket}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  return n <= limit;
}
