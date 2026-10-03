// Сдвиг начала горизонта: не перепланирование, а фиксация прошлого (БЛ-4).
// Тот же приём, что в complete.ts: всё, что по текущему расчёту начинается
// раньше новой границы, закрепляется на своих датах, затем переносится
// horizonStart. Движок дальше отрезает прожитую часть закреплённых этапов
// (правило «прошлое прожито» в scheduler.ts), поэтому даты релизов не меняются.

import type { AppData } from '../types';
import type { ScheduleResult } from './scheduler';
import { addDays, formatISO, mondayOfWeek, parseISO } from './dates';

/** Целевая дата сдвига: понедельник ПРЕДЫДУЩЕЙ недели — одна неделя
    прошлого остаётся видимой для контекста. */
export function shiftTarget(todayISO: string): string {
  const d = parseISO(todayISO);
  const dow = (d.getDay() + 6) % 7; // пн = 0
  return formatISO(addDays(d, -dow - 7));
}

/** Насколько далеко назад растягивается гант при просмотре прошлого, недель. */
const MAX_PAST_WEEKS = 52;

/**
 * С какой даты рисовать гант в режиме «Прошлое»: понедельник недели самого
 * раннего этапа, закреплённого до начала плана (их оставляют сдвиг горизонта
 * и завершение задач). null — в прошлом показывать нечего.
 */
export function pastViewStart(data: AppData): string | null {
  let earliest: string | null = null;
  for (const t of data.tasks) {
    for (const s of t.stages) {
      const pin = s.pinnedStartDate;
      // Пин без исполнителя движок игнорирует (кроме завершённых задач).
      if (!pin || pin >= data.horizonStart || !(t.done || s.assigneeId)) continue;
      if (!earliest || pin < earliest) earliest = pin;
    }
  }
  if (!earliest) return null;
  const limit = formatISO(addDays(parseISO(data.horizonStart), -MAX_PAST_WEEKS * 7));
  const start = mondayOfWeek(earliest > limit ? earliest : limit);
  return start < data.horizonStart ? start : null;
}

/** Сдвинуть начало горизонта на newStart, закрепив всё, что начинается
    раньше него, на текущих рассчитанных датах. Инвариант: релизы не едут. */
export function shiftHorizonStart(
  data: AppData,
  result: ScheduleResult,
  newStart: string,
): AppData {
  const startByStage = new Map<string, string>();
  for (const s of result.scheduledStages) {
    if (s.startIndex >= 0 && !s.clippedStart) {
      startByStage.set(s.stageId, result.days[s.startIndex]);
    }
  }
  return {
    ...data,
    horizonStart: newStart,
    tasks: data.tasks.map((t) => ({
      ...t,
      stages: t.stages.map((s) => {
        // Уже закреплённые не трогаем (обрезанные — тоже: их реальный старт
        // и так в pinnedStartDate); пин без исполнителя движок игнорирует.
        if (s.pinnedStartDate || !s.assigneeId) return s;
        const start = startByStage.get(s.id);
        return start && start < newStart ? { ...s, pinnedStartDate: start } : s;
      }),
    })),
  };
}
