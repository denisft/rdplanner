// Публикация плана в общее хранилище (read-only ссылка для коллег).
// Бэкенд — serverless-функции /api/save, /api/load и /api/delete на Vercel
// (Upstash Redis). В ссылке — только id для чтения; право перезаписи и отзыва
// даёт editKey, который сервер выдаёт при первой публикации и который хранится
// только в localStorage автора. «Поделиться» перезаписывает тот же план —
// ссылка остаётся постоянной.

import type { AppData } from '../types';

const SHARE_ID_KEY = 'resource-planner:shareId';
const EDIT_KEY_KEY = 'resource-planner:shareEditKey';

/** Секрет не подошёл: старую ссылку обновить или отозвать не получится. */
export class WrongEditKeyError extends Error {}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим — игнорируем
  }
}

export function getShareId(): string | null {
  return lsGet(SHARE_ID_KEY);
}

/** Забыть опубликованную ссылку локально (id и секрет). */
export function clearShare(): void {
  try {
    localStorage.removeItem(SHARE_ID_KEY);
    localStorage.removeItem(EDIT_KEY_KEY);
  } catch {
    // приватный режим — игнорируем
  }
}

/** Опубликовать текущий план. Переиспользует сохранённый id, если он есть. */
export async function publishPlan(data: AppData): Promise<string> {
  const id = getShareId();
  const editKey = lsGet(EDIT_KEY_KEY);
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, editKey, data }),
  });
  if (res.status === 403) throw new WrongEditKeyError('Wrong edit key');
  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  const json = (await res.json()) as { id: string; editKey?: string };
  lsSet(SHARE_ID_KEY, json.id);
  // Сервер выдаёт секрет при создании плана (и при миграции старых планов).
  if (json.editKey) lsSet(EDIT_KEY_KEY, json.editKey);
  return json.id;
}

/** Отозвать ссылку: удалить план с сервера и забыть id/секрет локально. */
export async function revokePlan(): Promise<void> {
  const id = getShareId();
  if (!id) return;
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, editKey: lsGet(EDIT_KEY_KEY) }),
  });
  if (res.status === 403) throw new WrongEditKeyError('Wrong edit key');
  if (!res.ok) throw new Error(`Revoke failed: ${res.status}`);
  clearShare();
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
