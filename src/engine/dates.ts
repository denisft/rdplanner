// Утилиты для работы с рабочими днями (пн–пт). Выходные пропускаются.
// Дата как строка YYYY-MM-DD, чтобы не зависеть от таймзоны.

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // вс или сб
}

function addDays(date: Date, n: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + n);
  return r;
}

/** Если дата выпадает на выходной, сдвигает на ближайший следующий рабочий день. */
export function nextWorkingDay(date: Date): Date {
  let d = new Date(date);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Массив из `count` рабочих дней начиная с startISO (включительно). */
export function generateWorkingDays(startISO: string, count: number): string[] {
  const result: string[] = [];
  let cursor = nextWorkingDay(parseISO(startISO));
  while (result.length < count) {
    result.push(formatISO(cursor));
    cursor = addDays(cursor, 1);
    cursor = nextWorkingDay(cursor);
  }
  return result;
}

/** Множество индексов рабочих дней, попадающих в диапазон [from, to] включительно. */
export function rangeToIndices(
  from: string,
  to: string,
  dayToIndex: Map<string, number>,
): number[] {
  const indices: number[] = [];
  let cursor = parseISO(from);
  const end = parseISO(to);
  while (cursor <= end) {
    if (!isWeekend(cursor)) {
      const idx = dayToIndex.get(formatISO(cursor));
      if (idx !== undefined) indices.push(idx);
    }
    cursor = addDays(cursor, 1);
  }
  return indices;
}

/**
 * Ближайший релизный день — вторник или четверг — СТРОГО после qaEndISO.
 * Релиз происходит уже после того, как QA завершено.
 */
export function nextReleaseDay(qaEndISO: string): string {
  let d = addDays(parseISO(qaEndISO), 1);
  while (d.getDay() !== 2 && d.getDay() !== 4) {
    // 2 = вторник, 4 = четверг
    d = addDays(d, 1);
  }
  return formatISO(d);
}

export const SHORT_WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const SHORT_MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/** Короткая подпись даты для шапки Гантта, напр. "3 июн". */
export function shortLabel(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}
