// Публикация плана в общее хранилище (read-only ссылка для коллег).
// Бэкенд — serverless-функции /api/save и /api/load на Vercel (Upstash Redis).
// Идентификатор ссылки хранится локально, чтобы «Поделиться» перезаписывало
// один и тот же план — ссылка остаётся постоянной.

import type { AppData } from '../types';

const SHARE_ID_KEY = 'resource-planner:shareId';

export function getShareId(): string | null {
  try {
    return localStorage.getItem(SHARE_ID_KEY);
  } catch {
    return null;
  }
}

function setShareId(id: string): void {
  try {
    localStorage.setItem(SHARE_ID_KEY, id);
  } catch {
    // приватный режим — игнорируем
  }
}

/** Опубликовать текущий план. Переиспользует сохранённый id, если он есть. */
export async function publishPlan(data: AppData): Promise<string> {
  const id = getShareId();
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, data }),
  });
  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  const json = (await res.json()) as { id: string };
  setShareId(json.id);
  return json.id;
}

/** Загрузить опубликованный план по id (для просмотра коллегой). */
export async function fetchSharedPlan(id: string): Promise<AppData> {
  const res = await fetch(`/api/load?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const json = (await res.json()) as { data: AppData };
  return json.data;
}

/** Полная ссылка для отправки коллегам. */
export function shareUrl(id: string): string {
  return `${location.origin}${location.pathname}?plan=${id}`;
}

/** id плана из текущего URL (?plan=...), если открыли по общей ссылке. */
export function planIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get('plan');
}
