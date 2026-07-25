import { describe, it, expect } from 'vitest';
import { buildTaskSizingCsv } from './taskSizingCsv';
import type { TaskSizingRow } from '../engine/taskSizing';

function row(over: Partial<TaskSizingRow>): TaskSizingRow {
  return {
    taskId: 't1',
    taskName: 'A',
    priority: 1,
    effortDays: 3,
    size: 'XS',
    done: false,
    ...over,
  };
}

describe('buildTaskSizingCsv', () => {
  it('две колонки, завершённые помечены, спецсимволы экранированы', () => {
    const csv = buildTaskSizingCsv([
      row({ taskName: 'Обычная', size: 'M' }),
      row({ taskId: 't2', taskName: 'Готова', size: 'S', done: true }),
      row({ taskId: 't3', taskName: 'С; точкой с запятой', size: 'XL' }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Задача;Трудоёмкость');
    expect(lines[1]).toBe('Обычная;M');
    expect(lines[2]).toBe('Готова (завершена);S');
    expect(lines[3]).toBe('"С; точкой с запятой";XL');
  });

  it('пустой отчёт — только шапка', () => {
    expect(buildTaskSizingCsv([])).toBe('Задача;Трудоёмкость\r\n');
  });
});
