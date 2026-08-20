// Порядок этапов при ручном закреплении (БЛ: этапы задачи строго последовательны).
//
// Движок ставит закреплённый этап «ровно туда, куда бросили» и порядок не чинит —
// поэтому некорректное закрепление (ревью раньше конца разработки) надо не
// допускать на входе. Ограничение только снизу: все предыдущие этапы задачи
// должны закончиться до старта пина (их текущие расчётные даты — авторазмещаемые
// соседи от пина не двигаются).
//
// Сверху НЕ ограничиваем сознательно: сдвиг этапа вправо поверх следующего
// закреплённого — обычный сценарий «задача едет позже», следующие пины
// пользователь перетащит следом. Иначе план, где все этапы закреплены впритык
// (демо, любой план после ручной раскладки), замораживается целиком: у ранних
// этапов не остаётся ни одного допустимого дня. Возникшее нарушение порядка
// показывает предупреждение движка (см. schedule).

import type { Stage, Task } from '../types';
import type { ScheduleResult } from './scheduler';
import { addWorkingDays } from './dates';

export interface PinOrderBounds {
  /** Самый ранний допустимый день старта (null — снизу не ограничен). */
  minStart: string | null;
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
  if (idx === -1) return { minStart: null };

  // Максимум по всем предыдущим (а не только соседнему): границы честные,
  // даже если порядок в данных уже нарушен.
  let minStart: string | null = null;
  for (let i = 0; i < idx; i++) {
    const end = stageEndDate(task.stages[i], result);
    if (!end) continue;
    const dayAfter = addWorkingDays(end, 1);
    if (!minStart || dayAfter > minStart) minStart = dayAfter;
  }

  return { minStart };
}

/** Не нарушит ли закрепление этапа на дату startISO порядок этапов задачи. */
export function pinRespectsOrder(
  task: Task,
  stageId: string,
  startISO: string,
  result: ScheduleResult,
): boolean {
  const { minStart } = pinOrderBounds(task, stageId, result);
  return !minStart || startISO >= minStart;
}
