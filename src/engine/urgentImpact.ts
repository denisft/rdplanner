// Предпросмотр «срочной задачи» (БЛ-17): что будет с планом, если вставить
// задачу с высшим приоритетом. Рабочий стейт не меняется — считаем два прогона
// движка (как есть / с срочной) и дельту по окончаниям QA. Отчёт целиком
// производный, в AppData ничего нового не попадает.
//
// Та же дельта (releaseShifts) работает для любой правки задачи в боковой
// панели: «как это скажется на других» — сравнение двух расписаний.

import type { AppData, Task } from '../types';
import { schedule, type ScheduleResult } from './scheduler';

/**
 * Исход для затронутой задачи. Пока движок двигает этап только целиком,
 * любой конфликт = сдвиг вправо ('shift'); 'stall' появится с дроблением
 * этапов (БЛ-5).
 */
export type ImpactOutcome = 'shift' | 'stall';

export interface ImpactRow {
  taskId: string;
  taskName: string;
  /** Дата релиза до вставки срочной задачи. */
  releaseBefore: string | null;
  /** Дата релиза после вставки. */
  releaseAfter: string | null;
  /** Сдвиг окончания QA в рабочих днях (>0 = уехало вправо, <0 = раньше). */
  shiftDays: number;
  outcome: ImpactOutcome;
}

export interface UrgentImpact {
  /** Только затронутые задачи (shiftDays !== 0), по убыванию сдвига. */
  rows: ImpactRow[];
  /** Дата релиза самой срочной задачи в новом раскладе. */
  urgentRelease: string | null;
  /** Срочную задачу не удалось разместить в расчётном горизонте. */
  urgentUnplaced: boolean;
}

/**
 * Какие живые задачи сдвинулись между двумя расписаниями одного плана.
 * `changedTaskId` — задача, которую правят (её собственный сдвиг — не
 * «задело», а сама правка; в список не попадает).
 * Оба расписания должны строиться от одного horizonStart — тогда индексы
 * дней сравнимы напрямую.
 */
export function releaseShifts(
  before: ScheduleResult,
  after: ScheduleResult,
  changedTaskId?: string,
): ImpactRow[] {
  const beforeById = new Map(before.releases.map((r) => [r.taskId, r]));
  const rows: ImpactRow[] = [];

  for (const a of after.releases) {
    if (a.taskId === changedTaskId) continue;
    const b = beforeById.get(a.taskId);
    if (!b) continue;
    // Завершённые заморожены — «кого задело» только про живые задачи.
    if (a.done) continue;

    // Считаем в рабочих днях по qaEndIndex, а не по календарным датам релиза:
    // так не ловим артефакт округления правила вт/чт (nextReleaseDay).
    const shiftDays = a.qaEndIndex - b.qaEndIndex;
    if (shiftDays === 0) continue; // не задело — не показываем

    rows.push({
      taskId: a.taskId,
      taskName: a.taskName,
      releaseBefore: b.releaseDate,
      releaseAfter: a.releaseDate,
      shiftDays,
      outcome: 'shift', // до БЛ-5 всегда сдвиг
    });
  }

  rows.sort((x, y) => y.shiftDays - x.shiftDays);
  return rows;
}

export function urgentImpact(base: AppData, urgent: Task): UrgentImpact {
  const before = schedule(base);
  const after = schedule({ ...base, tasks: [...base.tasks, urgent] });
  const placed = after.releases.find((r) => r.taskId === urgent.id);
  return {
    rows: releaseShifts(before, after, urgent.id),
    urgentRelease: placed?.releaseDate ?? null,
    // Движок не нашёл слот в расчётном горизонте.
    urgentUnplaced: placed ? placed.qaEndIndex < 0 : false,
  };
}
