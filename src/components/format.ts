// Форматирование дат и поиск для таблицы задач и тостов.

import type { Employee, Task } from '../types';
import { parseISO, SHORT_MONTHS, SHORT_WEEKDAYS } from '../engine/dates';

export function formatShort(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** Дата релиза с днём недели, напр. «чт, 18 июн». */
export function formatRelease(iso: string | null): string {
  if (!iso) return '—';
  return `${SHORT_WEEKDAYS[parseISO(iso).getDay()]}, ${formatShort(iso)}`;
}

/** Совпадает ли задача с поиском: по названию или имени исполнителя. */
export function matchesQuery(task: Task, employees: Employee[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (task.name.toLowerCase().includes(q)) return true;
  return task.stages.some((s) => {
    const emp = s.assigneeId ? employees.find((e) => e.id === s.assigneeId) : null;
    return emp ? emp.name.toLowerCase().includes(q) : false;
  });
}
