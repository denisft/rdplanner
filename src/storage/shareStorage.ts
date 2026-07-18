// Публикация плана в общее хранилище (read-only ссылка для коллег).
// Бэкенд — serverless-функции /api/save, /api/load и /api/delete на Vercel
// (Upstash Redis). В ссылке — только id для чтения; право перезаписи и отзыва
// даёт editKey, который сервер выдаёт при первой публикации и который хранится
// только в localStorage автора. «Поделиться» перезаписывает тот же план —
// ссылка остаётся постоянной.
//
// Делимся всегда активной командой, поэтому id и секрет храним отдельно на
// каждую команду (ключ с суффиксом teamId) — у каждой команды своя постоянная
// ссылка, публикация одной не затирает ссылку другой.

import type { AppData } from '../types';
import { migrateAppData } from './migrate';

const SHARE_ID_KEY = 'resource-planner:shareId';
const EDIT_KEY_KEY = 'resource-planner:shareEditKey';

const idKey = (teamId: string) => `${SHARE_ID_KEY}:${teamId}`;
const editKeyKey = (teamId: string) => `${EDIT_KEY_KEY}:${teamId}`;

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

export function getShareId(teamId: string): string | null {
  return lsGet(idKey(teamId));
}

/** Забыть опубликованную ссылку команды локально (id и секрет). */
export function clearShare(teamId: string): void {
  try {
    localStorage.removeItem(idKey(teamId));
    localStorage.removeItem(editKeyKey(teamId));
  } catch {
    // приватный режим — игнорируем
  }
}

/** Опубликовать план команды. Переиспользует сохранённый id команды, если он есть. */
export async function publishPlan(teamId: string, data: AppData): Promise<string> {
  const id = getShareId(teamId);
  const editKey = lsGet(editKeyKey(teamId));
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, editKey, data }),
  });
  if (res.status === 403) throw new WrongEditKeyError('Wrong edit key');
  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  const json = (await res.json()) as { id: string; editKey?: string };
  lsSet(idKey(teamId), json.id);
  // Сервер выдаёт секрет при создании плана (и при миграции старых планов).
  if (json.editKey) lsSet(editKeyKey(teamId), json.editKey);
  return json.id;
}

/** Отозвать ссылку команды: удалить план с сервера и забыть id/секрет локально. */
export async function revokePlan(teamId: string): Promise<void> {
  const id = getShareId(teamId);
  if (!id) return;
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, editKey: lsGet(editKeyKey(teamId)) }),
  });
  if (res.status === 403) throw new WrongEditKeyError('Wrong edit key');
  if (!res.ok) throw new Error(`Revoke failed: ${res.status}`);
  clearShare(teamId);
}

/** Загрузить опубликованный план по id (для просмотра коллегой). */
export async function fetchSharedPlan(id: string): Promise<AppData> {
  const res = await fetch(`/api/load?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const json = (await res.json()) as { data: AppData };
  // Опубликованный план мог быть создан в старой схеме — мигрируем.
  return migrateAppData(json.data);
}

/** Полная ссылка для отправки коллегам. */
export function shareUrl(id: string): string {
  return `${location.origin}${location.pathname}?plan=${id}`;
}

/** id плана из текущего URL (?plan=...), если открыли по общей ссылке. */
export function planIdFromUrl(): string | null {
  return new URLSearchParams(location.search).get('plan');
}
