import { describe, it, expect } from 'vitest';
import { buildTaskStagesCsv } from './taskStagesCsv';
import type { TaskStagesReport, TaskStagesRow } from '../engine/taskStages';

const HEADER =
  'Задача;Статус;Архитектура, дн.;Разработка, дн.;Ревью кода, дн.;QA, дн.;Итого, дн.';

function row(over: Partial<TaskStagesRow>): TaskStagesRow {
  return {
    taskId: 't1',
    taskName: 'A',
    priority: 1,
    byType: { architecture: 1, development: 3, review: 0, qa: 2 },
    totalDays: 6,
    done: false,
    ...over,
  };
}

describe('buildTaskStagesCsv', () => {
  it('колонки по этапам, статус отдельной колонкой, в конце строка итогов', () => {
    const report: TaskStagesReport = {
      rows: [
        row({ taskName: 'Обычная' }),
        row({ taskId: 't2', taskName: 'С; точкой с запятой', done: true }),
      ],
      totalByType: { architecture: 2, development: 6, review: 0, qa: 4 },
      totalDays: 12,
    };
    const lines = buildTaskStagesCsv(report).trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('Обычная;В работе;1;3;0;2;6');
    expect(lines[2]).toBe('"С; точкой с запятой";Завершена;1;3;0;2;6');
    expect(lines[3]).toBe('Итого;;2;6;0;4;12');
  });

  it('пустой отчёт — только шапка, без строки итогов', () => {
    const empty: TaskStagesReport = {
      rows: [],
      totalByType: { architecture: 0, development: 0, review: 0, qa: 0 },
      totalDays: 0,
    };
    expect(buildTaskStagesCsv(empty)).toBe(HEADER + '\r\n');
  });
});
