// Выгрузка отчёта за период в markdown: сводка загрузки, кто чем занят,
// стартующие/завершающиеся задачи, этапы без исполнителя.
// Все данные уже посчитаны движком (buildPeriodReport) — здесь только текст.

import { SPECIALIZATION_LABELS, STAGE_LABELS } from '../types';
import type { PeriodReport, EmployeePeriodReport } from '../engine/report';
import { parseISO, SHORT_MONTHS } from '../engine/dates';

/** Дата с годом, напр. "15 июн 2026". */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Экранирует символ "|", чтобы имя задачи не ломало таблицу. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Человеческая подпись статуса загрузки для сводной таблицы. */
function statusLabel(e: EmployeePeriodReport): string {
  if (e.status === 'overloaded') return `🔴 перегружен (${e.overloadDays} дн. с наложением)`;
  if (e.status === 'underloaded') return `⚪ недогружен (свободно ${e.freeDays} дн.)`;
  return 'ок';
}

export function buildReportMarkdown(report: PeriodReport): string {
  const lines: string[] = [];
  lines.push(`# Отчёт по команде: ${formatDate(report.from)} — ${formatDate(report.to)}`);
  lines.push('');
  lines.push(
    `_Рабочих дней в периоде: ${report.totalDays}. Выгружено ${formatDate(
      new Date().toISOString().slice(0, 10),
    )}._`,
  );

  if (report.totalDays === 0) {
    lines.push('');
    lines.push('_В выбранном периоде нет рабочих дней внутри горизонта планирования._');
    return lines.join('\n') + '\n';
  }

  // Сводка загрузки.
  lines.push('');
  lines.push('## Загрузка команды');
  lines.push('');
  lines.push('| Сотрудник | Роль | Занято | Свободно | Статус |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const e of report.employees) {
    lines.push(
      `| ${cell(e.name)} | ${SPECIALIZATION_LABELS[e.specialization]} | ` +
        `${e.busyDays} из ${e.availableDays} дн. | ${e.freeDays} дн. | ${statusLabel(e)} |`,
    );
  }

  // Кто чем занят: одна таблица, строки сгруппированы по сотрудникам.
  lines.push('');
  lines.push('## Кто чем занят');
  lines.push('');
  const stageRows = report.employees.flatMap((e) =>
    e.stages.map((s) => {
      const name = `${s.taskName} — ${STAGE_LABELS[s.type]}${s.done ? ' ✓' : ''}`;
      return (
        `| ${cell(e.name)} | ${cell(name)} | ${formatDate(s.startDate)} | ` +
        `${formatDate(s.endDate)} | ${s.daysInPeriod} |`
      );
    }),
  );
  if (stageRows.length > 0) {
    lines.push('| Сотрудник | Задача — этап | Начало | Завершение | Дней в периоде |');
    lines.push('| --- | --- | --- | --- | --- |');
    lines.push(...stageRows);
  } else {
    lines.push('_Ни у кого нет этапов в этом периоде._');
  }

  lines.push('');
  lines.push(`## Стартуют в периоде (${report.starting.length})`);
  lines.push('');
  if (report.starting.length > 0) {
    lines.push('| Задача | Начало | Релиз (вт/чт) |');
    lines.push('| --- | --- | --- |');
    for (const t of report.starting) {
      lines.push(
        `| ${cell(t.taskName)} | ${formatDate(t.startDate)} | ${formatDate(t.releaseDate)} |`,
      );
    }
  } else {
    lines.push('_Нет задач, стартующих в периоде._');
  }

  lines.push('');
  lines.push(`## Завершаются в периоде (${report.finishing.length})`);
  lines.push('');
  if (report.finishing.length > 0) {
    lines.push('| Задача | QA готово | Релиз (вт/чт) |');
    lines.push('| --- | --- | --- |');
    for (const t of report.finishing) {
      lines.push(
        `| ${cell(t.taskName)} | ${formatDate(t.qaEndDate)} | ${formatDate(t.releaseDate)} |`,
      );
    }
  } else {
    lines.push('_Нет релизов в периоде._');
  }

  if (report.unassigned.length > 0) {
    lines.push('');
    lines.push(`## ⚠️ Этапы без исполнителя (${report.unassigned.length})`);
    lines.push('');
    lines.push('| Задача — этап | Начало | Завершение |');
    lines.push('| --- | --- | --- |');
    for (const s of report.unassigned) {
      lines.push(
        `| ${cell(`${s.taskName} — ${STAGE_LABELS[s.type]}`)} | ` +
          `${formatDate(s.startDate)} | ${formatDate(s.endDate)} |`,
      );
    }
  }

  return lines.join('\n') + '\n';
}

/** Собрать markdown и скачать как «отчёт_С_ПО.md». */
export function downloadReportMarkdown(report: PeriodReport): void {
  const md = buildReportMarkdown(report);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `отчёт_${report.from}_${report.to}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
