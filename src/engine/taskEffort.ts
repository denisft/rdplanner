// Отчёт «Часы по задачам за период»: сколько рабочих дней (и часов) каждой
// задачи пришлось на выбранный период, с разбивкой по типам этапов.
//
// Правила:
//  - В отличие от taskSizing.ts (размер задачи целиком) здесь считаются только
//    дни этапов, попавшие в период: задача на три месяца в отчёте за июль
//    покажет только июльские дни.
//  - Период — по рабочим дням внутри расчётного горизонта, как в report.ts;
//    прошлое до начала горизонта не считаем (у обрезанных этапов — только
//    хвост в сетке).
//  - Этапы без исполнителя входят: время задачи они занимают.
//  - Завершённые задачи включаются (с пометкой done) — отчёт за прошедший
//    период иначе был бы пустым.
//  - Планировщик не трекает факт: это дни по расчёту движка, а не таймшиты.
//    Часы — производная: 1 рабочий день = HOURS_PER_DAY часов.

import type { AppData, StageType } from '../types';
import { STAGE_ORDER } from '../types';
import type { ScheduleResult } from './scheduler';

/** Часов в рабочем дне — для пересчёта дней плана в часы. */
export const HOURS_PER_DAY = 8;

export interface TaskEffortRow {
  taskId: string;
  taskName: string;
  priority: number;
  /** Дни в периоде по типам этапов (0 — этапа нет или он не попал в период). */
  byType: Record<StageType, number>;
  /** Сумма дней всех этапов задачи, попавших в период. */
  totalDays: number;
  /** totalDays × HOURS_PER_DAY. */
  totalHours: number;
  done: boolean;
}

/** Дни задач, попавшие в период, с разбивкой по этапам. Порядок — по приоритету. */
export function buildTaskEffortReport(
  data: AppData,
  result: ScheduleResult,
  from: string,
  to: string,
): TaskEffortRow[] {
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

  // taskId -> дни в периоде по типам этапов.
  const byTask = new Map<string, Record<StageType, number>>();
  for (const s of result.scheduledStages) {
    if (s.startIndex < 0 || s.startIndex > toIdx || s.endIndex < fromIdx) continue;
    const days =
      Math.min(s.endIndex, toIdx) - Math.max(s.startIndex, fromIdx) + 1;
    let acc = byTask.get(s.taskId);
    if (!acc) {
      acc = { architecture: 0, development: 0, review: 0, qa: 0 };
      byTask.set(s.taskId, acc);
    }
    acc[s.type] += days;
  }

  return data.tasks
    .filter((t) => byTask.has(t.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'ru'))
    .map((t) => {
      const byType = byTask.get(t.id)!;
      const totalDays = STAGE_ORDER.reduce((sum, type) => sum + byType[type], 0);
      return {
        taskId: t.id,
        taskName: t.name,
        priority: t.priority,
        byType,
        totalDays,
        totalHours: totalDays * HOURS_PER_DAY,
        done: t.done === true,
      };
    });
}
