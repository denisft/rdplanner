// Объяснимость размещения (БЛ-1): факты из движка -> человеческий текст.
//
// Движок (scheduler.ts) отдаёт факторы как данные, здесь они превращаются в
// строки для ганта. Разделение нужно, чтобы формулировки проверялись тестами
// без прогона всего расписания и чтобы движок не знал про интерфейс.

import type { PlacementFactor, StageConflict, StagePlacement } from './scheduler';
import { STAGE_LABELS } from '../types';
import { parseISO, SHORT_MONTHS, shortLabel } from './dates';

export interface Explanation {
  /** Одна строка сверху: «Не раньше 14 июл» / «Закреплён вручную на 14 июл». */
  headline: string;
  /** Почему не раньше — по строке на фактор. Пусто — ничего не мешало. */
  lines: string[];
  /** Наложения с другими этапами того же человека. */
  conflicts: string[];
}

/** Диапазон дат одной строкой: «12–13 июл», «30 июн – 2 июл», «14 июл». */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortLabel(from);
  const a = parseISO(from);
  const b = parseISO(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${b.getDate()} ${SHORT_MONTHS[a.getMonth()]}`;
  }
  return `${shortLabel(from)} – ${shortLabel(to)}`;
}

/** Кто именно занят/недоступен: имя, если известно. */
function who(employeeName?: string): string {
  return employeeName ?? 'исполнитель';
}

function factorLine(f: PlacementFactor, employeeName?: string): string | null {
  switch (f.kind) {
    case 'prevStage':
      return `предыдущий этап «${STAGE_LABELS[f.stageType]}» заканчивается ${shortLabel(f.endDate)}`;
    case 'earliestStart':
      return `задача не начинается раньше ${shortLabel(f.date)}`;
    case 'busy':
      return `${who(employeeName)} занят ${rangeLabel(f.from, f.to)} — «${f.taskName}» · ${STAGE_LABELS[f.stageType]}${
        f.pinned ? ' (закреплён вручную)' : ''
      }`;
    case 'unavailable':
      return `${who(employeeName)} недоступен ${rangeLabel(f.from, f.to)} (отпуск или больничный)`;
    case 'shortGap':
      return `свободное окно короче этапа: подряд было ${f.freeDays} дн, нужно ${f.neededDays}`;
    case 'noAssignee':
      return 'исполнитель не назначен — этап учтён по времени, но ничью загрузку не занимает';
    case 'noSlot':
      return 'свободного окна не нашлось до конца расчётного горизонта';
    case 'manualPin':
      // Уходит в заголовок — в списке причин дублировать незачем.
      return null;
  }
}

function conflictLine(c: StageConflict): string {
  return `${rangeLabel(c.from, c.to)} — «${c.taskName}» · ${STAGE_LABELS[c.stageType]}${
    c.pinned ? ' (закреплён вручную)' : ''
  }`;
}

/**
 * Объяснение размещения этапа для показа человеку.
 * `employeeName` — имя исполнителя (без него текст обезличенный).
 */
export function explainPlacement(
  placement: StagePlacement | undefined,
  employeeName?: string,
): Explanation {
  if (!placement) {
    return { headline: 'Причина размещения неизвестна', lines: [], conflicts: [] };
  }

  const lines = placement.factors
    .map((f) => factorLine(f, employeeName))
    .filter((l): l is string => l !== null);
  const conflicts = placement.conflicts.map(conflictLine);

  const pin = placement.factors.find((f) => f.kind === 'manualPin');
  let headline: string;
  if (pin && pin.kind === 'manualPin') {
    headline = `Закреплён вручную на ${shortLabel(pin.date)}`;
  } else if (!placement.startDate) {
    headline = 'Разместить не удалось';
  } else if (lines.length === 0) {
    headline = `Начинается ${shortLabel(placement.startDate)} — ничто не мешало начать раньше`;
  } else {
    headline = `Не раньше ${shortLabel(placement.startDate)}, потому что:`;
  }

  return { headline, lines, conflicts };
}
