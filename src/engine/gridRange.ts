import type { ScheduleResult } from './scheduler';

/** Запас пустой сетки справа от последнего этапа или релиза, рабочих дней. */
const TAIL_DAYS = 5;

/**
 * Сколько рабочих дней рисовать на ганте. Выбранный горизонт (`horizonWeeks`)
 * — это масштаб и минимальная длина сетки, а не обрезка: сетка тянется до
 * последнего этапа или релиза плюс неделя запаса, округляясь до целой недели.
 * Иначе этап, перетащенный за правый край, пропадал бы из виду вместе
 * с датой своего окончания.
 */
export function gridDayCount(result: ScheduleResult, horizonWeeks: number): number {
  let last = -1;
  for (const s of result.scheduledStages) last = Math.max(last, s.endIndex);
  for (const r of result.releases) {
    if (r.done || !r.releaseDate) continue;
    last = Math.max(last, result.days.indexOf(r.releaseDate));
  }
  const needed = last >= 0 ? Math.ceil((last + 1 + TAIL_DAYS) / 5) * 5 : 0;
  return Math.min(result.days.length, Math.max(horizonWeeks * 5, needed));
}
