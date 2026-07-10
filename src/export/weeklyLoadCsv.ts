// CSV «Загрузка по неделям»: строки — пары «эпик × сотрудник» группами по
// эпикам, колонки — недели периода, в ячейках % загрузки сотрудника.
// Все данные уже посчитаны движком (buildWeeklyLoadReport) — здесь только текст.
// Разделитель «;», кодировка UTF-8 с BOM — как в csvExport.ts.

import { SPECIALIZATION_LABELS } from '../types';
import type { WeeklyLoadReport, ReportWeek } from '../engine/weeklyLoad';
import { parseISO } from '../engine/dates';
import { cell } from './csvExport';

/** Подпись недели в шапке: "01.06–05.06" (неполная неделя — её реальные края). */
function weekLabel(w: ReportWeek): string {
  const f = (iso: string) => {
    const d = parseISO(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}`;
  };
  return w.start === w.end ? f(w.start) : `${f(w.start)}–${f(w.end)}`;
}

/** Ячейка загрузки: процент без дробей, null — сотрудник всю неделю в отпуске. */
function loadCell(v: number | null): string {
  return v === null ? 'отпуск' : `${Math.round(v * 100)}%`;
}

export function buildWeeklyLoadCsv(report: WeeklyLoadReport): string {
  const header = ['Эпик', 'Сотрудник', 'Роль', ...report.weeks.map(weekLabel)];
  const rows = report.rows.map((r) =>
    [
      r.done ? `${r.taskName} (завершена)` : r.taskName,
      r.employeeName,
      SPECIALIZATION_LABELS[r.specialization],
      ...r.load.map(loadCell),
    ]
      .map(cell)
      .join(';'),
  );
  return [header.join(';'), ...rows].join('\r\n') + '\r\n';
}

/** Собрать CSV и скачать как «загрузка_С_ПО.csv». */
export function downloadWeeklyLoadCsv(report: WeeklyLoadReport): void {
  const csv = buildWeeklyLoadCsv(report);
  // BOM обязателен: без него Excel открывает UTF-8 в системной кодировке.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `загрузка_${report.from}_${report.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
