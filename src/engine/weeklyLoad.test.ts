import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { buildWeeklyLoadReport } from './weeklyLoad';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('buildWeeklyLoadReport', () => {
  it('разбивает период на недели и считает % загрузки', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 8, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    // Две полные недели: 01–05.06 и 08–12.06. Этап на 8 дней: 5 + 3.
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-12');
    expect(rep.weeks).toHaveLength(2);
    expect(rep.weeks[0]).toMatchObject({ start: '2026-06-01', end: '2026-06-05' });
    expect(rep.weeks[1]).toMatchObject({ start: '2026-06-08', end: '2026-06-12' });
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].taskId).toBe('t1');
    expect(rep.rows[0].employeeName).toBe('dev');
    expect(rep.rows[0].load[0]).toBeCloseTo(1);
    expect(rep.rows[0].load[1]).toBeCloseTo(3 / 5);
  });

  it('крайние недели периода неполные, % считается от их дней', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 10, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    // Период ср 03.06 — вт 09.06: неделя из 3 дней (ср–пт) и неделя из 2 (пн–вт).
    const rep = buildWeeklyLoadReport(data, r, '2026-06-03', '2026-06-09');
    expect(rep.weeks).toHaveLength(2);
    expect(rep.weeks[0]).toMatchObject({ start: '2026-06-03', end: '2026-06-05' });
    expect(rep.weeks[1]).toMatchObject({ start: '2026-06-08', end: '2026-06-09' });
    // Этап на 10 дней перекрывает обе недели целиком.
    expect(rep.rows[0].load).toEqual([1, 1]);
  });

  it('отпуск уменьшает знаменатель, полная неделя отпуска без работы — null', () => {
    const dev = emp('dev');
    dev.unavailable = [{ from: '2026-06-01', to: '2026-06-05' }]; // вся 1-я неделя
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    // Этап уедет на 2-ю неделю (08–10.06): в 1-й null, во 2-й 3 из 5.
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-12');
    expect(rep.rows[0].load[0]).toBeNull();
    expect(rep.rows[0].load[1]).toBeCloseTo(3 / 5);
  });

  it('частичный отпуск: % считается от доступных дней', () => {
    const dev = emp('dev');
    dev.unavailable = [{ from: '2026-06-04', to: '2026-06-05' }]; // чт–пт
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    // Занято пн–ср, доступно 3 дня — загрузка 100%.
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.rows[0].load[0]).toBeCloseTo(1);
  });

  it('закреплённый этап поверх отпуска считается от полной недели', () => {
    const dev = emp('dev');
    dev.unavailable = [{ from: '2026-06-01', to: '2026-06-05' }];
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            {
              id: 's1',
              type: 'development',
              durationDays: 2,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-01',
            },
          ],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.rows[0].load[0]).toBeCloseTo(2 / 5);
  });

  it('наложение закреплённых этапов двух задач даёт в сумме >100%', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
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
        {
          id: 't2',
          name: 'B',
          priority: 2,
          stages: [
            {
              id: 's2',
              type: 'development',
              durationDays: 3,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-02',
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.rows).toHaveLength(2);
    expect(rep.rows[0].load[0]! + rep.rows[1].load[0]!).toBeCloseTo(6 / 5);
  });

  it('строки сгруппированы по приоритету задач, внутри — по специализации', () => {
    const lead: Employee = {
      id: 'lead',
      name: 'Лид',
      specialization: 'lead',
      unavailable: [],
    };
    const data = base(
      [
        {
          id: 't2',
          name: 'Второй',
          priority: 2,
          stages: [
            { id: 's3', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
        {
          id: 't1',
          name: 'Первый',
          priority: 1,
          stages: [
            { id: 's1', type: 'architecture', durationDays: 2, assigneeId: 'lead' },
            { id: 's2', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev'), lead],
    );
    const r = schedule(data);
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-12');
    expect(rep.rows.map((x) => `${x.taskId}:${x.employeeId}`)).toEqual([
      't1:lead',
      't1:dev',
      't2:dev',
    ]);
  });

  it('завершённая задача входит в отчёт с пометкой done', () => {
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
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].done).toBe(true);
    expect(rep.rows[0].load[0]).toBeCloseTo(3 / 5);
  });

  it('этап без исполнителя не попадает в отчёт', () => {
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
    const rep = buildWeeklyLoadReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.rows).toHaveLength(0);
  });

  it('период без рабочих дней — пустой отчёт', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    // Суббота и воскресенье.
    const rep = buildWeeklyLoadReport(data, r, '2026-06-06', '2026-06-07');
    expect(rep.weeks).toHaveLength(0);
    expect(rep.rows).toHaveLength(0);
  });
});
