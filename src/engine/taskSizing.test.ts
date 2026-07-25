import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { effortSize, buildTaskSizingReport } from './taskSizing';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { teams: [{ id: 'team-1', name: 'Команда 1' }], employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('effortSize', () => {
  it('шкала непрерывна: границы размеров без дырок', () => {
    expect(effortSize(1)).toBe('XS');
    expect(effortSize(4)).toBe('XS');
    expect(effortSize(5)).toBe('S');
    expect(effortSize(10)).toBe('S');
    expect(effortSize(11)).toBe('M'); // «2,5 недели» — уже M
    expect(effortSize(20)).toBe('M');
    expect(effortSize(21)).toBe('L');
    expect(effortSize(30)).toBe('L');
    expect(effortSize(31)).toBe('XL');
    expect(effortSize(100)).toBe('XL');
  });
});

describe('buildTaskSizingReport', () => {
  it('трудоёмкость — сумма всех этапов, даже если в период попала часть', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 8, assigneeId: 'dev' },
            { id: 's2', type: 'qa', durationDays: 4, assigneeId: 'tester' },
          ],
        },
      ],
      [emp('dev'), emp('tester', 'tester')],
    );
    data.employees[1].specialization = 'qa';
    const r = schedule(data);
    // Период — только первая неделя, но размер считается по задаче целиком.
    const rows = buildTaskSizingReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].effortDays).toBe(12);
    expect(rows[0].size).toBe('M');
  });

  it('задача вне периода не попадает в отчёт', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Сначала',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 5, assigneeId: 'dev' },
          ],
        },
        {
          id: 't2',
          name: 'Потом',
          priority: 2,
          stages: [
            { id: 's2', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    // Первая неделя: t1 занимает пн–пт, t2 начнётся только со следующей.
    const week1 = buildTaskSizingReport(data, r, '2026-06-01', '2026-06-05');
    expect(week1.map((t) => t.taskId)).toEqual(['t1']);
    // Вторая неделя: только t2.
    const week2 = buildTaskSizingReport(data, r, '2026-06-08', '2026-06-12');
    expect(week2.map((t) => t.taskId)).toEqual(['t2']);
  });

  it('завершённые задачи включаются с пометкой done', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Done',
          priority: 1,
          done: true,
          completedAt: '2026-06-01',
          stages: [
            {
              id: 's1',
              type: 'development',
              durationDays: 3,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-01',
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const rows = buildTaskSizingReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(true);
    expect(rows[0].size).toBe('XS');
  });

  it('порядок — по приоритету; период вне горизонта — пусто', () => {
    const data = base(
      [
        {
          id: 't2',
          name: 'Ниже',
          priority: 5,
          stages: [
            { id: 's2', type: 'development', durationDays: 2, assigneeId: 'dev2' },
          ],
        },
        {
          id: 't1',
          name: 'Выше',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev'), emp('dev2')],
    );
    const r = schedule(data);
    const rows = buildTaskSizingReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows.map((t) => t.taskId)).toEqual(['t1', 't2']);
    expect(buildTaskSizingReport(data, r, '2026-01-01', '2026-01-10')).toEqual([]);
  });
});
