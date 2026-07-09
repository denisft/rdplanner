// Выгрузка таблицы «Задачи и даты релизов» в CSV.
// Колонки как на экране: приоритет, задача, окончание QA, дата релиза.
// Разделитель — «;», кодировка UTF-8 с BOM (чтобы Excel не показывал крякозябры).

import type { Task } from '../types';
import type { TaskRelease } from '../engine/scheduler';
import { parseISO } from '../engine/dates';

/** Дата для Excel: "ДД.ММ.ГГГГ", пустая дата — пустая ячейка. */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Экранирование по RFC 4180: кавычки, разделитель и переносы строк — в двойных кавычках. */
function cell(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Собирает CSV из релизов (в переданном порядке — как в таблице на экране). */
export function buildReleasesCsv(releases: TaskRelease[], tasks: Task[]): string {
  const priority = new Map(tasks.map((t) => [t.id, t.priority]));
  const header = ['Приоритет', 'Задача', 'QA готово', 'Релиз (вт/чт)'];
  const rows = releases.map((rel) =>
    [
      String(priority.get(rel.taskId) ?? ''),
      rel.taskName,
      formatDate(rel.qaEndDate),
      formatDate(rel.releaseDate),
    ]
      .map(cell)
      .join(';'),
  );
  return [header.join(';'), ...rows].join('\r\n') + '\r\n';
}

/** Собрать CSV и скачать как файл «релизы_ГГГГ-ММ-ДД.csv» (дата выгрузки). */
export function downloadReleasesCsv(releases: TaskRelease[], tasks: Task[]): void {
  const csv = buildReleasesCsv(releases, tasks);
  // BOM обязателен: без него Excel открывает UTF-8 в системной кодировке.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `релизы_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
