// Выгрузка плана в markdown одной таблицей, сгруппированной по задачам.
// Каждая строка — этап: «задача + этап», исполнитель, начало, завершение, релиз.
// Строки идут блоками по задачам (в порядке приоритета), этапы — по дате начала.
// Все данные уже посчитаны движком (ScheduleResult) — здесь только сборка текста.

import type { AppData } from '../types';
import { STAGE_LABELS } from '../types';
import type { ScheduleResult } from '../engine/scheduler';
import { parseISO, SHORT_MONTHS } from '../engine/dates';

/** Дата с годом для выгрузки, напр. "15 июн 2026". */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Экранирует символ "|", чтобы имя задачи не ломало таблицу. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function buildMarkdown(data: AppData, result: ScheduleResult): string {
  const empName = new Map(data.employees.map((e) => [e.id, e.name]));

  // Этапы по задачам — чтобы под каждым заголовком собрать только её строки.
  const stagesByTask = new Map<string, ScheduleResult['scheduledStages']>();
  for (const s of result.scheduledStages) {
    const list = stagesByTask.get(s.taskId) ?? [];
    list.push(s);
    stagesByTask.set(s.taskId, list);
  }

  const tableHeader =
    '| Задача + этап | Кто назначен | Начало этапа | Завершение этапа | Дата релиза |\n' +
    '| --- | --- | --- | --- | --- |';

  // result.releases уже в порядке приоритета задач (как их раскладывал движок).
  // Завершённые задачи в выгрузку не идут — это план работы, а не архив.
  const rows = result.releases.filter((rel) => !rel.done).flatMap((rel) => {
    // Этапы задачи в порядке начала (нераспределённые — в конец).
    const stages = [...(stagesByTask.get(rel.taskId) ?? [])].sort((a, b) => {
      if (a.startIndex < 0) return 1;
      if (b.startIndex < 0) return -1;
      return a.startIndex - b.startIndex;
    });

    const release = formatDate(rel.releaseDate);
    return stages.map((s) => {
      const taskStage = `${rel.taskName} — ${STAGE_LABELS[s.type]}`;
      const who = s.assigneeId
        ? empName.get(s.assigneeId) ?? '—'
        : '— (без исполнителя)';
      const start =
        s.startIndex >= 0 ? formatDate(result.days[s.startIndex]) : '—';
      const end = s.endIndex >= 0 ? formatDate(result.days[s.endIndex]) : '—';
      return `| ${cell(taskStage)} | ${cell(who)} | ${start} | ${end} | ${release} |`;
    });
  });

  const title = `# План команды\n\n_Выгружено ${formatDate(
    new Date().toISOString().slice(0, 10),
  )}_\n`;

  const body =
    rows.length > 0 ? `${tableHeader}\n${rows.join('\n')}` : '_Нет этапов._';

  return `${title}\n${body}\n`;
}

/** Собрать markdown и скачать как .md файл. */
export function downloadMarkdown(data: AppData, result: ScheduleResult): void {
  const md = buildMarkdown(data, result);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'team-plan.md';
  a.click();
  URL.revokeObjectURL(url);
}
