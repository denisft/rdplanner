import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { buildTaskEffortReport, HOURS_PER_DAY } from './taskEffort';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { teams: [{ id: 'team-1', name: 'Команда 1' }], employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('buildTaskEffortReport', () => {
  it('считает только дни, попавшие в период, с разбивкой по типам этапов', () => {
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
      [emp('dev'), emp('tester')],
    );
    data.employees[1].specialization = 'qa';
    const r = schedule(data);

    // Первая неделя: только разработка (пн–пт), QA ещё не начался.
    const week1 = buildTaskEffortReport(data, r, '2026-06-01', '2026-06-05');
    expect(week1).toHaveLength(1);
    expect(week1[0].byType.development).toBe(5);
    expect(week1[0].byType.qa).toBe(0);
    expect(week1[0].totalDays).toBe(5);
    expect(week1[0].totalHours).toBe(5 * HOURS_PER_DAY);

    // Вторая неделя: хвост разработки (3 дня) + начало QA (2 дня).
    const week2 = buildTaskEffortReport(data, r, '2026-06-08', '2026-06-12');
    expect(week2[0].byType.development).toBe(3);
    expect(week2[0].byType.qa).toBe(2);
    expect(week2[0].totalDays).toBe(5);

    // Весь горизонт: задача целиком, 8 + 4.
    const all = buildTaskEffortReport(data, r, '2026-06-01', '2026-06-26');
    expect(all[0].byType.development).toBe(8);
    expect(all[0].byType.qa).toBe(4);
    expect(all[0].totalDays).toBe(12);
    expect(all[0].totalHours).toBe(12 * HOURS_PER_DAY);
  });

  it('этап без исполнителя входит в часы задачи', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 3, assigneeId: null },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const rows = buildTaskEffortReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].byType.development).toBe(3);
    expect(rows[0].totalDays).toBe(3);
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
    const rows = buildTaskEffortReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(true);
    expect(rows[0].totalDays).toBe(3);
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
    const rows = buildTaskEffortReport(data, r, '2026-06-01', '2026-06-05');
    expect(rows.map((t) => t.taskId)).toEqual(['t1', 't2']);
    expect(buildTaskEffortReport(data, r, '2026-01-01', '2026-01-10')).toEqual([]);
  });
});
