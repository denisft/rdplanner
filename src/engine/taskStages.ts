// Отчёт «Задачи по этапам»: все задачи плана за всё время, сколько рабочих
// дней запланировано на каждый тип этапа.
//
// Правила:
//  - В отличие от taskEffort.ts (дни, попавшие в период) здесь задача берётся
//    целиком и без периода: сумма durationDays её этапов по типам. Расписание
//    не нужно — этапы, уехавшие за начало горизонта, тоже считаются.
//  - Входят все задачи, которые есть в плане: и в работе, и завершённые.
//    Удалённые задачи планировщик не хранит — их в отчёте нет.
//  - Этапы без исполнителя входят: это запланированное время задачи.
//  - Планировщик не трекает факт: это плановые длительности, а не таймшиты.

import type { AppData, StageType } from '../types';
import { STAGE_ORDER } from '../types';

export interface TaskStagesRow {
  taskId: string;
  taskName: string;
  priority: number;
  /** Запланированные дни по типам этапов (0 — этапа у задачи нет). */
  byType: Record<StageType, number>;
  /** Сумма дней всех этапов задачи. */
  totalDays: number;
  done: boolean;
}

export interface TaskStagesReport {
  rows: TaskStagesRow[];
  /** Сумма по всем задачам — по типам этапов и общая. */
  totalByType: Record<StageType, number>;
  totalDays: number;
}

/** Все задачи с днями по этапам. Порядок — сначала в работе, потом завершённые; внутри по приоритету. */
export function buildTaskStagesReport(data: AppData): TaskStagesReport {
  const totalByType: Record<StageType, number> = {
    architecture: 0,
    development: 0,
    review: 0,
    qa: 0,
  };

  const rows = [...data.tasks]
    .sort(
      (a, b) =>
        Number(a.done === true) - Number(b.done === true) ||
        a.priority - b.priority ||
        a.name.localeCompare(b.name, 'ru'),
    )
    .map((t) => {
      const byType: Record<StageType, number> = {
        architecture: 0,
        development: 0,
        review: 0,
        qa: 0,
      };
      for (const s of t.stages) {
        byType[s.type] += s.durationDays;
        totalByType[s.type] += s.durationDays;
      }
      return {
        taskId: t.id,
        taskName: t.name,
        priority: t.priority,
        byType,
        totalDays: STAGE_ORDER.reduce((sum, type) => sum + byType[type], 0),
        done: t.done === true,
      };
    });

  return {
    rows,
    totalByType,
    totalDays: STAGE_ORDER.reduce((sum, type) => sum + totalByType[type], 0),
  };
}
