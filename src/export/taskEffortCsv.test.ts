import { describe, it, expect } from 'vitest';
import { buildTaskEffortCsv } from './taskEffortCsv';
import type { TaskEffortRow } from '../engine/taskEffort';

const HEADER =
  'Задача;Архитектура, дн.;Разработка, дн.;Ревью кода, дн.;QA, дн.;Итого, дн.;Итого, ч.';

function row(over: Partial<TaskEffortRow>): TaskEffortRow {
  return {
    taskId: 't1',
    taskName: 'A',
    priority: 1,
    byType: { architecture: 0, development: 3, review: 0, qa: 2 },
    totalDays: 5,
    totalHours: 40,
    done: false,
    ...over,
  };
}

describe('buildTaskEffortCsv', () => {
  it('колонки по этапам, завершённые помечены, спецсимволы экранированы', () => {
    const csv = buildTaskEffortCsv([
      row({ taskName: 'Обычная' }),
      row({ taskId: 't2', taskName: 'Готова', done: true }),
      row({ taskId: 't3', taskName: 'С; точкой с запятой' }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    // Запятые в заголовках не экранируются: разделитель — «;».
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('Обычная;0;3;0;2;5;40');
    expect(lines[2]).toBe('Готова (завершена);0;3;0;2;5;40');
    expect(lines[3]).toBe('"С; точкой с запятой";0;3;0;2;5;40');
  });

  it('пустой отчёт — только шапка', () => {
    expect(buildTaskEffortCsv([])).toBe(HEADER + '\r\n');
  });
});
