// Порядок этапов при ручном закреплении (БЛ: этапы задачи строго последовательны).
//
// Движок ставит закреплённый этап «ровно туда, куда бросили» и порядок не чинит —
// поэтому некорректное закрепление (ревью раньше конца разработки) надо не
// допускать на входе. Здесь считаются границы, в которых этап можно закрепить:
//  - снизу: все предыдущие этапы задачи должны закончиться до старта пина
//    (их текущие расчётные даты — авторазмещаемые соседи от пина не двигаются);
//  - сверху: конец пина должен быть раньше старта ближайшего следующего
//    ЗАКРЕПЛЁННОГО этапа (незакреплённые следующие перетекут вправо сами).

import type { Stage, Task } from '../types';
import type { ScheduleResult } from './scheduler';
import { addWorkingDays } from './dates';

export interface PinOrderBounds {
  /** Самый ранний допустимый день старта (null — снизу не ограничен). */
  minStart: string | null;
  /** Старт ближайшего следующего закреплённого этапа: конец блока должен быть
      строго раньше этой даты (null — сверху не ограничен). */
  nextPinnedStart: string | null;
}

/** Текущая расчётная дата окончания этапа; null — этап не размещён. */
function stageEndDate(stage: Stage, result: ScheduleResult): string | null {
  const sched = result.scheduledStages.find((s) => s.stageId === stage.id);
  if (sched && sched.endIndex >= 0 && sched.endIndex < result.days.length) {
    return result.days[sched.endIndex];
  }
  // Целиком прожит до горизонта (startIndex -1) или конец за расчётной сеткой —
  // считаем от пина напрямую, по образцу pastEndDate в scheduler.
  if (stage.pinnedStartDate) {
    return addWorkingDays(stage.pinnedStartDate, stage.durationDays - 1);
  }
  return null;
}

/** Границы, в которых этап можно закрепить, не ломая порядок этапов задачи. */
export function pinOrderBounds(
  task: Task,
  stageId: string,
  result: ScheduleResult,
): PinOrderBounds {
  const idx = task.stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return { minStart: null, nextPinnedStart: null };

  // Максимум по всем предыдущим (а не только соседнему): границы честные,
  // даже если порядок в данных уже нарушен.
  let minStart: string | null = null;
  for (let i = 0; i < idx; i++) {
    const end = stageEndDate(task.stages[i], result);
    if (!end) continue;
    const dayAfter = addWorkingDays(end, 1);
    if (!minStart || dayAfter > minStart) minStart = dayAfter;
  }

  let nextPinnedStart: string | null = null;
  for (let i = idx + 1; i < task.stages.length; i++) {
    const pin = task.stages[i].pinnedStartDate;
    if (!pin) continue;
    if (!nextPinnedStart || pin < nextPinnedStart) nextPinnedStart = pin;
  }

  return { minStart, nextPinnedStart };
}

/** Не нарушит ли закрепление этапа на дату startISO порядок этапов задачи. */
export function pinRespectsOrder(
  task: Task,
  stageId: string,
  startISO: string,
  result: ScheduleResult,
): boolean {
  const stage = task.stages.find((s) => s.id === stageId);
  if (!stage) return true;
  const { minStart, nextPinnedStart } = pinOrderBounds(task, stageId, result);
  if (minStart && startISO < minStart) return false;
  if (nextPinnedStart) {
    const endISO = addWorkingDays(startISO, stage.durationDays - 1);
    if (endISO >= nextPinnedStart) return false;
  }
  return true;
}
