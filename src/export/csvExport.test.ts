import { describe, it, expect } from 'vitest';
import { buildReleasesCsv } from './csvExport';
import type { TaskRelease } from '../engine/scheduler';
import type { Task } from '../types';

// Для CSV важны только id и priority — остальное движок не читает.
const task = (id: string, priority: number): Task =>
  ({ id, name: id, priority, stages: [] }) as Task;

const rel = (
  taskId: string,
  taskName: string,
  qaEndDate: string | null,
  releaseDate: string | null,
): TaskRelease => ({
  taskId,
  taskName,
  qaEndIndex: 0,
  qaEndDate,
  releaseDate,
  done: false,
});

describe('buildReleasesCsv', () => {
  it('собирает заголовок и строки с датами ДД.ММ.ГГГГ через ";"', () => {
    const csv = buildReleasesCsv(
      [rel('t1', 'Оплата картой', '2026-06-05', '2026-06-09')],
      [task('t1', 1)],
    );
    expect(csv).toBe(
      'Приоритет;Задача;QA готово;Релиз (вт/чт)\r\n' +
        '1;Оплата картой;05.06.2026;09.06.2026\r\n',
    );
  });

  it('пустые даты — пустые ячейки', () => {
    const csv = buildReleasesCsv([rel('t1', 'Задача', null, null)], [task('t1', 2)]);
    expect(csv).toContain('2;Задача;;\r\n');
  });

  it('экранирует по RFC 4180: ";" и кавычки в имени задачи', () => {
    const csv = buildReleasesCsv(
      [rel('t1', 'Импорт; экспорт "CSV"', '2026-06-05', '2026-06-09')],
      [task('t1', 1)],
    );
    expect(csv).toContain('"Импорт; экспорт ""CSV""";05.06.2026;09.06.2026');
  });

  it('сохраняет переданный порядок строк', () => {
    const csv = buildReleasesCsv(
      [rel('b', 'Вторая', null, null), rel('a', 'Первая', null, null)],
      [task('a', 1), task('b', 2)],
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toContain('Вторая');
    expect(lines[2]).toContain('Первая');
  });
});
