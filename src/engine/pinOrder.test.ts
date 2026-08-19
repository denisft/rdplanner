import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { pinOrderBounds, pinRespectsOrder } from './pinOrder';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return {
    teams: [{ id: 'team-1', name: 'Команда 1' }],
    employees,
    tasks,
    horizonStart: '2026-06-01',
    horizonWeeks: 4,
  };
}

describe('pinOrderBounds / pinRespectsOrder', () => {
  it('этап нельзя закрепить раньше конца предыдущего', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        // Разработка авторазмещается на пн–ср (2026-06-01..03).
        { id: 'dev', type: 'development', durationDays: 3, assigneeId: 'dev' },
        { id: 'rev', type: 'review', durationDays: 1, assigneeId: 'lead' },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    expect(pinOrderBounds(task, 'rev', r).minStart).toBe('2026-06-04');
    // Внутрь и на последний день разработки — нельзя, на следующий — можно.
    expect(pinRespectsOrder(task, 'rev', '2026-06-02', r)).toBe(false);
    expect(pinRespectsOrder(task, 'rev', '2026-06-03', r)).toBe(false);
    expect(pinRespectsOrder(task, 'rev', '2026-06-04', r)).toBe(true);
  });

  it('минимальный старт перепрыгивает выходные', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        // Разработка занимает всю неделю: пн–пт (2026-06-01..05).
        { id: 'dev', type: 'development', durationDays: 5, assigneeId: 'dev' },
        { id: 'rev', type: 'review', durationDays: 1, assigneeId: 'lead' },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    // День после пт — понедельник следующей недели.
    expect(pinOrderBounds(task, 'rev', r).minStart).toBe('2026-06-08');
  });

  it('конец этапа не должен наезжать на следующий закреплённый', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        { id: 'dev', type: 'development', durationDays: 3, assigneeId: 'dev' },
        {
          id: 'rev',
          type: 'review',
          durationDays: 1,
          assigneeId: 'lead',
          pinnedStartDate: '2026-06-08', // пн второй недели
        },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    expect(pinOrderBounds(task, 'dev', r).nextPinnedStart).toBe('2026-06-08');
    // Старт ср: конец пт 05.06 — раньше пина, можно.
    expect(pinRespectsOrder(task, 'dev', '2026-06-03', r)).toBe(true);
    // Старт чт: конец пн 08.06 — день пина, нельзя.
    expect(pinRespectsOrder(task, 'dev', '2026-06-04', r)).toBe(false);
  });

  it('незакреплённые следующие этапы не ограничивают: перетекут сами', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        { id: 'dev', type: 'development', durationDays: 3, assigneeId: 'dev' },
        { id: 'rev', type: 'review', durationDays: 1, assigneeId: 'lead' },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    expect(pinOrderBounds(task, 'dev', r).nextPinnedStart).toBeNull();
    expect(pinRespectsOrder(task, 'dev', '2026-06-22', r)).toBe(true);
  });

  it('предыдущий этап целиком в прошлом всё равно даёт нижнюю границу', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        {
          id: 'arch',
          type: 'architecture',
          durationDays: 2,
          assigneeId: 'lead',
          pinnedStartDate: '2026-05-18', // целиком до горизонта, конец 19.05
        },
        { id: 'dev', type: 'development', durationDays: 3, assigneeId: 'dev' },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    expect(pinOrderBounds(task, 'dev', r).minStart).toBe('2026-05-20');
    expect(pinRespectsOrder(task, 'dev', '2026-06-01', r)).toBe(true);
  });

  it('первый этап задачи снизу не ограничен', () => {
    const task: Task = {
      id: 't1',
      name: 'A',
      priority: 1,
      stages: [
        { id: 'dev', type: 'development', durationDays: 3, assigneeId: 'dev' },
      ],
    };
    const r = schedule(base([task], [emp('dev')]));
    expect(pinOrderBounds(task, 'dev', r).minStart).toBeNull();
    expect(pinRespectsOrder(task, 'dev', '2026-06-01', r)).toBe(true);
  });
});
