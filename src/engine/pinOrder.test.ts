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

  it('следующий закреплённый этап не ограничивает сверху: план впритык не замораживается', () => {
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
    // Сдвиг разработки поверх пина ревью разрешён — пользователь перетащит
    // ревью следом; нарушение порядка покажет предупреждение движка.
    expect(pinRespectsOrder(task, 'dev', '2026-06-03', r)).toBe(true);
    expect(pinRespectsOrder(task, 'dev', '2026-06-04', r)).toBe(true);
    expect(pinRespectsOrder(task, 'dev', '2026-06-08', r)).toBe(true);
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

  it('план, закреплённый впритык (как демо), не замораживается', () => {
    // Регрессия: верхняя граница по следующему пину не оставляла ранним
    // этапам ни одного допустимого дня — архитектуру и разработку было
    // вообще не перетащить.
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
          pinnedStartDate: '2026-06-01',
        },
        {
          id: 'dev',
          type: 'development',
          durationDays: 3,
          assigneeId: 'dev',
          pinnedStartDate: '2026-06-03',
        },
      ],
    };
    const r = schedule(base([task], [emp('dev'), emp('lead')]));
    // Архитектуру можно двигать и вправо, даже поверх пина разработки.
    expect(pinRespectsOrder(task, 'arch', '2026-06-02', r)).toBe(true);
    expect(pinRespectsOrder(task, 'arch', '2026-06-05', r)).toBe(true);
    // Разработку — на любой день после конца архитектуры, но не раньше.
    expect(pinOrderBounds(task, 'dev', r).minStart).toBe('2026-06-03');
    expect(pinRespectsOrder(task, 'dev', '2026-06-02', r)).toBe(false);
    expect(pinRespectsOrder(task, 'dev', '2026-06-10', r)).toBe(true);
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
