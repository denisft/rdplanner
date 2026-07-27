// CSV «Часы по задачам за период»: строка — задача, колонки — дни по типам
// этапов, попавшие в период, итог в днях и часах (engine/taskEffort.ts).
// Завершённые помечаются в названии, как в taskSizingCsv.ts.
// Разделитель «;», кодировка UTF-8 с BOM — как в csvExport.ts.

import { STAGE_LABELS, STAGE_ORDER } from '../types';
import type { TaskEffortRow } from '../engine/taskEffort';
import { cell } from './csvExport';

export function buildTaskEffortCsv(rows: TaskEffortRow[]): string {
  const header = [
    'Задача',
    ...STAGE_ORDER.map((t) => `${STAGE_LABELS[t]}, дн.`),
    'Итого, дн.',
    'Итого, ч.',
  ];
  const lines = rows.map((r) =>
    [
      r.done ? `${r.taskName} (завершена)` : r.taskName,
      ...STAGE_ORDER.map((t) => String(r.byType[t])),
      String(r.totalDays),
      String(r.totalHours),
    ]
      .map(cell)
      .join(';'),
  );
  return [header.join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Собрать CSV и скачать как «часы_по_задачам_С_ПО.csv». */
export function downloadTaskEffortCsv(
  rows: TaskEffortRow[],
  from: string,
  to: string,
): void {
  const csv = buildTaskEffortCsv(rows);
  // BOM обязателен: без него Excel открывает UTF-8 в системной кодировке.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `часы_по_задачам_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
