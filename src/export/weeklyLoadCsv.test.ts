import { describe, it, expect } from 'vitest';
import { buildWeeklyLoadCsv } from './weeklyLoadCsv';
import type { WeeklyLoadReport } from '../engine/weeklyLoad';

function report(): WeeklyLoadReport {
  return {
    from: '2026-06-01',
    to: '2026-06-12',
    weeks: [
      { start: '2026-06-01', end: '2026-06-05', firstIdx: 0, lastIdx: 4 },
      { start: '2026-06-08', end: '2026-06-12', firstIdx: 5, lastIdx: 9 },
    ],
    rows: [
      {
        taskId: 't1',
        taskName: 'Личный кабинет',
        done: false,
        employeeId: 'e1',
        employeeName: 'Иванов',
        specialization: 'backend',
        load: [1, 0.6],
      },
      {
        taskId: 't2',
        taskName: 'Интеграция; фаза 2',
        done: true,
        employeeId: 'e2',
        employeeName: 'Петрова',
        specialization: 'qa',
        load: [null, 1 / 3],
      },
    ],
  };
}

describe('buildWeeklyLoadCsv', () => {
  it('собирает шапку с неделями и строки с процентами', () => {
    const lines = buildWeeklyLoadCsv(report()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Эпик;Сотрудник;Роль;01.06–05.06;08.06–12.06');
    expect(lines[1]).toBe('Личный кабинет;Иванов;Разработчики бэк;100%;60%');
  });

  it('помечает завершённые, экранирует «;», отпуск — словом', () => {
    const lines = buildWeeklyLoadCsv(report()).trimEnd().split('\r\n');
    expect(lines[2]).toBe('"Интеграция; фаза 2 (завершена)";Петрова;QA;отпуск;33%');
  });

  it('неделя из одного дня подписывается одной датой', () => {
    const r = report();
    r.weeks = [{ start: '2026-06-01', end: '2026-06-01', firstIdx: 0, lastIdx: 0 }];
    r.rows = [];
    const lines = buildWeeklyLoadCsv(r).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Эпик;Сотрудник;Роль;01.06');
  });
});
