// CSV «Трудоёмкость задач»: строка — задача, пересекающая период,
// колонки — название и размер в футболках (XS–XL из engine/taskSizing.ts).
// Завершённые помечаются в названии, как в weeklyLoadCsv.ts.
// Разделитель «;», кодировка UTF-8 с BOM — как в csvExport.ts.

import type { TaskSizingRow } from '../engine/taskSizing';
import { cell } from './csvExport';

export function buildTaskSizingCsv(rows: TaskSizingRow[]): string {
  const header = ['Задача', 'Трудоёмкость'];
  const lines = rows.map((r) =>
    [r.done ? `${r.taskName} (завершена)` : r.taskName, r.size].map(cell).join(';'),
  );
  return [header.join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Собрать CSV и скачать как «трудоёмкость_С_ПО.csv». */
export function downloadTaskSizingCsv(
  rows: TaskSizingRow[],
  from: string,
  to: string,
): void {
  const csv = buildTaskSizingCsv(rows);
  // BOM обязателен: без него Excel открывает UTF-8 в системной кодировке.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `трудоёмкость_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
