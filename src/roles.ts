// Какие специализации допустимы на каком этапе. Единый источник правды —
// используется и в форме задачи, и при drag-and-drop в Гантте.

import type { Employee, StageType } from './types';

// Этапы, которые разработчик может получить персонально (lead-only по базе).
// Используется в форме сотрудника для показа галочек.
export const GRANTABLE_EXTRA_STAGES: StageType[] = ['architecture', 'review'];

export function stageAllows(type: StageType, emp: Employee): boolean {
  // Персонально выданное право перекрывает базовые ограничения специализации.
  if (emp.extraStages?.includes(type)) return true;
  const spec = emp.specialization;
  if (type === 'architecture' || type === 'review') return spec === 'lead';
  if (type === 'qa') return spec === 'qa';
  // Разработка: разработчики и лиды (лид может сам писать код по задаче).
  return spec === 'backend' || spec === 'frontend' || spec === 'lead';
}

export function assigneePool(type: StageType, employees: Employee[]): Employee[] {
  return employees.filter((e) => stageAllows(type, e));
}
