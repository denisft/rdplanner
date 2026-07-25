// Отчёт «Трудоёмкость задач за период»: задачи, чья работа пересекает период,
// с размером в футболках (XS–XL) по суммарной длительности этапов.
//
// Правила:
//  - В отчёт попадает задача, у которой хотя бы один размещённый этап
//    пересекается с периодом (по рабочим дням внутри расчётного горизонта —
//    как в buildPeriodReport, прошлое до начала горизонта не считаем).
//  - Трудоёмкость = сумма durationDays всех этапов задачи, включая этапы вне
//    периода: это размер задачи целиком, а не «сколько её пришлось на период».
//  - Неделя = 5 рабочих дней. Шкала непрерывная, без дырок на границах:
//    XS < 5 дн., S ≤ 10, M ≤ 20, L ≤ 30, XL > 30.
//  - Завершённые задачи включаются (с пометкой done) — отчёт за прошедший
//    период иначе был бы пустым.

import type { AppData } from '../types';
import type { ScheduleResult } from './scheduler';

export type TaskSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

/** Размер по суммарной трудоёмкости в рабочих днях (неделя = 5 дней). */
export function effortSize(days: number): TaskSize {
  if (days < 5) return 'XS';
  if (days <= 10) return 'S';
  if (days <= 20) return 'M';
  if (days <= 30) return 'L';
  return 'XL';
}

export interface TaskSizingRow {
  taskId: string;
  taskName: string;
  priority: number;
  /** Сумма длительностей всех этапов, рабочие дни. */
  effortDays: number;
  size: TaskSize;
  done: boolean;
}

/** Задачи, пересекающие период, с размером трудоёмкости. Порядок — по приоритету. */
export function buildTaskSizingReport(
  data: AppData,
  result: ScheduleResult,
  from: string,
  to: string,
): TaskSizingRow[] {
  // Границы периода в индексах рабочих дней (обе включительно), как в report.ts.
  let fromIdx = -1;
  let toIdx = -2;
  for (let i = 0; i < result.days.length; i++) {
    const d = result.days[i];
    if (d < from) continue;
    if (d > to) break;
    if (fromIdx === -1) fromIdx = i;
    toIdx = i;
  }
  if (fromIdx < 0) return [];

  const inPeriod = new Set<string>();
  for (const s of result.scheduledStages) {
    if (s.startIndex >= 0 && s.startIndex <= toIdx && s.endIndex >= fromIdx) {
      inPeriod.add(s.taskId);
    }
  }

  return data.tasks
    .filter((t) => inPeriod.has(t.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'ru'))
    .map((t) => {
      const effortDays = t.stages.reduce((sum, s) => sum + s.durationDays, 0);
      return {
        taskId: t.id,
        taskName: t.name,
        priority: t.priority,
        effortDays,
        size: effortSize(effortDays),
        done: t.done === true,
      };
    });
}
