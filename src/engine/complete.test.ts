import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { completeTask, reopenTask } from './complete';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('completeTask', () => {
  it('замораживает этапы на рассчитанных датах и ставит флаг', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'architecture', durationDays: 2, assigneeId: 'lead' },
            { id: 's2', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('lead'), emp('dev')],
    );
    const r = schedule(data);
    const next = completeTask(data, r, 't1', '2026-06-10');

    const t = next.tasks[0];
    expect(t.done).toBe(true);
    expect(t.completedAt).toBe('2026-06-10');
    // Этапы закреплены ровно там, где их рассчитал движок.
    expect(t.stages[0].pinnedStartDate).toBe('2026-06-01');
    expect(t.stages[1].pinnedStartDate).toBe('2026-06-03');

    // После заморозки расписание не меняется: этапы стоят на тех же местах.
    const r2 = schedule(next);
    const s1 = r2.scheduledStages.find((s) => s.stageId === 's1')!;
    const s2 = r2.scheduledStages.find((s) => s.stageId === 's2')!;
    expect(s1.startIndex).toBe(0);
    expect(s2.startIndex).toBe(2);
    expect(s1.pinned).toBe(true);
    expect(s1.done).toBe(true);
  });

  it('этап без исполнителя не закрепляется (движок игнорирует его pin)', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' },
            { id: 's2', type: 'qa', durationDays: 1, assigneeId: null },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const next = completeTask(data, r, 't1', '2026-06-10');
    expect(next.tasks[0].stages[0].pinnedStartDate).toBe('2026-06-01');
    expect(next.tasks[0].stages[1].pinnedStartDate).toBeUndefined();
  });

  it('не трогает другие задачи', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' }],
        },
        {
          id: 't2',
          name: 'B',
          priority: 2,
          stages: [{ id: 's2', type: 'development', durationDays: 2, assigneeId: 'dev' }],
        },
      ],
      [emp('dev')],
    );
    const next = completeTask(data, schedule(data), 't1', '2026-06-10');
    expect(next.tasks[1].done).toBeUndefined();
    expect(next.tasks[1].stages[0].pinnedStartDate).toBeUndefined();
  });
});

describe('reopenTask', () => {
  it('снимает флаг завершения, но сохраняет закрепления', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' }],
        },
      ],
      [emp('dev')],
    );
    const completed = completeTask(data, schedule(data), 't1', '2026-06-10');
    const reopened = reopenTask(completed, 't1');
    const t = reopened.tasks[0];
    expect(t.done).toBe(false);
    expect(t.completedAt).toBeUndefined();
    // Ничего не прыгает: этап остаётся закреплённым на своей дате.
    expect(t.stages[0].pinnedStartDate).toBe('2026-06-01');
  });
});
