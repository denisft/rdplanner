// Границы и валидация плана для публикации по ссылке (/api/save).
// Живёт в src, а не в api: так код проверяется tsc и покрывается тестами,
// serverless-функции импортируют его как единственный источник правды
// о том, что считается допустимым планом.

/** Максимальный размер сериализованного плана — защита хранилища от мусора. */
export const MAX_PLAN_BYTES = 500 * 1024;
/** Максимумы по количеству — план на сотни людей это уже не наш сценарий. */
export const MAX_EMPLOYEES = 300;
export const MAX_TASKS = 1000;

/** id опубликованного плана — часть ссылки для чтения. */
export const PLAN_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
/** Секрет владельца ссылки: только у автора, даёт право перезаписи и отзыва. */
export const EDIT_KEY_RE = /^[a-zA-Z0-9_-]{16,128}$/;

/** Размер плана в байтах (как он ляжет в хранилище). */
export function planSizeBytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/**
 * Структурная проверка присланного плана. Возвращает текст ошибки или null.
 * Проверяем ровно то, на что полагаемся при чтении: массивы, строки-имена,
 * этапы у задач. Лишние поля не запрещаем — схема растёт, старый API
 * не должен отбрасывать планы новых клиентов.
 */
export function validatePlanData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return 'Invalid plan data';
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.employees) || !Array.isArray(d.tasks))
    return 'Invalid plan data';
  if (d.employees.length > MAX_EMPLOYEES)
    return `Too many employees (max ${MAX_EMPLOYEES})`;
  if (d.tasks.length > MAX_TASKS) return `Too many tasks (max ${MAX_TASKS})`;
  for (const e of d.employees) {
    const emp = e as Record<string, unknown> | null;
    if (!emp || typeof emp.id !== 'string' || typeof emp.name !== 'string')
      return 'Invalid employee';
  }
  for (const t of d.tasks) {
    const task = t as Record<string, unknown> | null;
    if (
      !task ||
      typeof task.id !== 'string' ||
      typeof task.name !== 'string' ||
      !Array.isArray(task.stages)
    )
      return 'Invalid task';
  }
  return null;
}
