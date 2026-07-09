import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { buildPeriodReport } from './report';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('buildPeriodReport', () => {
  it('считает занятые, свободные и доступные дни в периоде', () => {
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
    // Первая рабочая неделя: пн 01.06 — пт 05.06, 5 рабочих дней.
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.totalDays).toBe(5);
    const dev = rep.employees[0];
    expect(dev.availableDays).toBe(5);
    expect(dev.busyDays).toBe(3);
    expect(dev.freeDays).toBe(2);
    expect(dev.utilization).toBeCloseTo(0.6);
    expect(dev.status).toBe('normal');
    expect(dev.stages).toHaveLength(1);
    expect(dev.stages[0].daysInPeriod).toBe(3);
  });

  it('выходные не входят в период, границы обрезают этап', () => {
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
    // Период ср 03.06 — вт 09.06 захватывает выходные: рабочих дней 5.
    const rep = buildPeriodReport(data, r, '2026-06-03', '2026-06-09');
    expect(rep.totalDays).toBe(5);
    const dev = rep.employees[0];
    // Этап на 10 дней перекрывает весь период, но в периоде только 5 его дней.
    expect(dev.stages[0].daysInPeriod).toBe(5);
    expect(dev.busyDays).toBe(5);
    expect(dev.freeDays).toBe(0);
  });

  it('отпуск уменьшает доступные дни, недогрузка ниже порога флагуется', () => {
    const dev = emp('dev');
    dev.unavailable = [{ from: '2026-06-04', to: '2026-06-05' }]; // чт–пт
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 1, assigneeId: 'dev' },
          ],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    const d = rep.employees[0];
    expect(d.availableDays).toBe(3); // 5 минус 2 дня отпуска
    expect(d.busyDays).toBe(1);
    expect(d.utilization).toBeCloseTo(1 / 3);
    expect(d.status).toBe('underloaded');
  });

  it('наложение закреплённых этапов даёт статус «перегружен»', () => {
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
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    const d = rep.employees[0];
    expect(d.overloadDays).toBe(2); // вт и ср заняты двумя этапами
    expect(d.status).toBe('overloaded');
  });

  it('стартующие и завершающиеся задачи попадают в свои секции', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Стартует и завершается',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
        {
          id: 't2',
          name: 'Стартует позже',
          priority: 2,
          stages: [
            { id: 's2', type: 'development', durationDays: 20, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    // Первая неделя: t1 стартует пн 01.06, QA готово вт 02.06, релиз чт 04.06.
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.starting.map((t) => t.taskId)).toEqual(['t1', 't2']);
    expect(rep.finishing.map((t) => t.taskId)).toEqual(['t1']);
    expect(rep.finishing[0].releaseDate).toBe('2026-06-04');

    // Через месяц t2 всё ещё идёт: ни стартует, ни завершается.
    const later = buildPeriodReport(data, r, '2026-06-15', '2026-06-19');
    expect(later.starting).toHaveLength(0);
    expect(later.finishing).toHaveLength(0);
    // Но занятость видна.
    expect(later.employees[0].busyDays).toBe(5);
  });

  it('этап без исполнителя попадает в unassigned, а не в загрузку', () => {
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
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    expect(rep.unassigned).toHaveLength(1);
    expect(rep.unassigned[0].taskId).toBe('t1');
    expect(rep.employees[0].busyDays).toBe(0);
  });

  it('завершённая задача занимает человека, но не попадает в секции задач', () => {
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
    const rep = buildPeriodReport(data, r, '2026-06-01', '2026-06-05');
    const d = rep.employees[0];
    // Занятость учтена, этап в списке с пометкой done.
    expect(d.busyDays).toBe(3);
    expect(d.stages).toHaveLength(1);
    expect(d.stages[0].done).toBe(true);
    // Но в стартующие/завершающиеся архив не попадает.
    expect(rep.starting).toHaveLength(0);
    expect(rep.finishing).toHaveLength(0);
  });

  it('период вне горизонта или без рабочих дней — пустой отчёт', () => {
    const data = base([], [emp('dev')]);
    const r = schedule(data);
    // Суббота и воскресенье.
    const weekend = buildPeriodReport(data, r, '2026-06-06', '2026-06-07');
    expect(weekend.totalDays).toBe(0);
    expect(weekend.employees).toHaveLength(0);
    // До начала горизонта.
    const past = buildPeriodReport(data, r, '2026-01-01', '2026-01-10');
    expect(past.totalDays).toBe(0);
  });
});
