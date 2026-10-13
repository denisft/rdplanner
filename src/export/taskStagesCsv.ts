// CSV «Задачи по этапам»: строка — задача, колонки — плановые дни по типам
// этапов и итог (engine/taskStages.ts); последняя строка — итог по всем задачам.
// Статус — отдельной колонкой, чтобы в Excel фильтровать завершённые.
// Разделитель «;», кодировка UTF-8 с BOM — как в csvExport.ts.

import { STAGE_LABELS, STAGE_ORDER } from '../types';
import type { TaskStagesReport } from '../engine/taskStages';
import { cell } from './csvExport';

export function buildTaskStagesCsv(report: TaskStagesReport): string {
  const header = [
    'Задача',
    'Статус',
    ...STAGE_ORDER.map((t) => `${STAGE_LABELS[t]}, дн.`),
    'Итого, дн.',
  ];
  const lines = report.rows.map((r) =>
    [
      r.taskName,
      r.done ? 'Завершена' : 'В работе',
      ...STAGE_ORDER.map((t) => String(r.byType[t])),
      String(r.totalDays),
    ]
      .map(cell)
      .join(';'),
  );
  if (report.rows.length > 0) {
    lines.push(
      [
        'Итого',
        '',
        ...STAGE_ORDER.map((t) => String(report.totalByType[t])),
        String(report.totalDays),
      ]
        .map(cell)
        .join(';'),
    );
  }
  return [header.join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Собрать CSV и скачать как «задачи_по_этапам_ГГГГ-ММ-ДД.csv» (дата выгрузки). */
export function downloadTaskStagesCsv(report: TaskStagesReport): void {
  const csv = buildTaskStagesCsv(report);
  // BOM обязателен: без него Excel открывает UTF-8 в системной кодировке.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `задачи_по_этапам_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
