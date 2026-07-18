// Предпросмотр «срочной задачи» (БЛ-17): что будет с планом, если вставить
// задачу с высшим приоритетом. Рабочий стейт не меняется — считаем два прогона
// движка (как есть / с срочной) и дельту по окончаниям QA. Отчёт целиком
// производный, в AppData ничего нового не попадает.

import type { AppData, Task } from '../types';
import { schedule } from './scheduler';

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
  /** Сдвиг окончания QA в рабочих днях (>0 = уехало вправо). */
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

export function urgentImpact(base: AppData, urgent: Task): UrgentImpact {
  const before = schedule(base);
  const after = schedule({ ...base, tasks: [...base.tasks, urgent] });

  const beforeById = new Map(before.releases.map((r) => [r.taskId, r]));

  const rows: ImpactRow[] = [];
  let urgentRelease: string | null = null;
  let urgentUnplaced = false;

  for (const a of after.releases) {
    if (a.taskId === urgent.id) {
      urgentRelease = a.releaseDate;
      urgentUnplaced = a.qaEndIndex < 0; // движок не нашёл слот
      continue;
    }
    const b = beforeById.get(a.taskId);
    if (!b) continue;
    // Завершённые заморожены — «кого задело» только про живые задачи.
    if (a.done) continue;

    // Оба расписания строятся от одного horizonStart → индексы сравнимы напрямую.
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
  return { rows, urgentRelease, urgentUnplaced };
}
