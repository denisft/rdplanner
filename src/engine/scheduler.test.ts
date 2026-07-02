import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('schedule', () => {
  it('этапы внутри задачи идут строго последовательно', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Task 1',
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
    const arch = r.scheduledStages.find((s) => s.stageId === 's1')!;
    const dev = r.scheduledStages.find((s) => s.stageId === 's2')!;
    expect(arch.startIndex).toBe(0);
    expect(arch.endIndex).toBe(1);
    // разработка не раньше дня после окончания архитектуры
    expect(dev.startIndex).toBe(2);
    expect(dev.endIndex).toBe(4);
  });

  it('не допускает двойного букинга одного человека', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' }],
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
    const r = schedule(data);
    const a = r.scheduledStages.find((s) => s.stageId === 's1')!;
    const b = r.scheduledStages.find((s) => s.stageId === 's2')!;
    expect(a.startIndex).toBe(0);
    expect(a.endIndex).toBe(2);
    // вторая задача встаёт после первой, без пересечения
    expect(b.startIndex).toBe(3);
    // нет перегруженных дней
    for (const [, byDay] of r.occupancy) {
      for (const [, list] of byDay) expect(list.length).toBeLessThanOrEqual(1);
    }
  });

  it('приоритет решает, кто получает слот раньше', () => {
    const tasks: Task[] = [
      {
        id: 'low',
        name: 'Low',
        priority: 5,
        stages: [{ id: 'sl', type: 'development', durationDays: 2, assigneeId: 'dev' }],
      },
      {
        id: 'high',
        name: 'High',
        priority: 1,
        stages: [{ id: 'sh', type: 'development', durationDays: 2, assigneeId: 'dev' }],
      },
    ];
    const r = schedule(base(tasks, [emp('dev')]));
    const high = r.scheduledStages.find((s) => s.stageId === 'sh')!;
    const low = r.scheduledStages.find((s) => s.stageId === 'sl')!;
    expect(high.startIndex).toBe(0); // высокий приоритет — первым
    expect(low.startIndex).toBe(2);
  });

  it('обходит дни недоступности (отпуск)', () => {
    const dev = emp('dev');
    // 2026-06-03 и 2026-06-04 — недоступен (ср и чт первой недели = индексы 2 и 3)
    dev.unavailable = [{ from: '2026-06-03', to: '2026-06-04' }];
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 2, assigneeId: 'dev' }],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    const s = r.scheduledStages.find((x) => x.stageId === 's1')!;
    // непрерывный блок из 2 дней не помещается на индексы 0-1 (т.к. далее идут недоступные),
    // 0-1 свободны → должен встать на 0-1. Проверим, что не залез на недоступные 2-3.
    expect(s.startIndex).toBe(0);
    expect(s.endIndex).toBe(1);
  });

  it('недоступность в середине отодвигает непрерывный блок', () => {
    const dev = emp('dev');
    // недоступен индекс 1 (вторник 2026-06-02)
    dev.unavailable = [{ from: '2026-06-02', to: '2026-06-02' }];
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' }],
        },
      ],
      [dev],
    );
    const r = schedule(data);
    const s = r.scheduledStages.find((x) => x.stageId === 's1')!;
    // блок из 3 подряд: индексы 0,1,2 нельзя (1 недоступен) → старт на 2 (2,3,4)
    expect(s.startIndex).toBe(2);
    expect(s.endIndex).toBe(4);
  });

  it('пропускает выходные при расчёте дат', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [{ id: 's1', type: 'development', durationDays: 5, assigneeId: 'dev' }],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const rel = r.releases[0];
    // 5 рабочих дней от пн 2026-06-01 → пт 2026-06-05 (конец QA)
    expect(r.days[0]).toBe('2026-06-01');
    expect(rel.qaEndDate).toBe('2026-06-05');
    // релиз — ближайший вт/чт строго после пт 5 июн → вт 9 июн
    expect(rel.releaseDate).toBe('2026-06-09');
  });

  it('закреплённый этап стоит ровно на своей дате', () => {
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
              pinnedStartDate: '2026-06-04', // чт первой недели = индекс 3
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const s = r.scheduledStages.find((x) => x.stageId === 's1')!;
    expect(s.startIndex).toBe(3);
    expect(s.endIndex).toBe(4);
    expect(s.pinned).toBe(true);
  });

  it('авторазмещение обтекает закреплённый этап', () => {
    const data = base(
      [
        {
          id: 'pin',
          name: 'Pinned',
          priority: 2,
          stages: [
            {
              id: 'sp',
              type: 'development',
              durationDays: 2,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-01', // индексы 0-1
            },
          ],
        },
        {
          id: 'auto',
          name: 'Auto',
          priority: 1, // выше приоритет, но слот 0-1 занят пином
          stages: [
            { id: 'sa', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const auto = r.scheduledStages.find((s) => s.stageId === 'sa')!;
    expect(auto.startIndex).toBe(2); // обтекает закреплённые 0-1
    // нет перегрузки
    for (const [, byDay] of r.occupancy)
      for (const [, list] of byDay) expect(list.length).toBeLessThanOrEqual(1);
  });

  it('два закреплённых этапа на один день дают перегрузку', () => {
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
        {
          id: 't2',
          name: 'B',
          priority: 2,
          stages: [
            {
              id: 's2',
              type: 'development',
              durationDays: 2,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-02',
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = schedule(data);
    const byDay = r.occupancy.get('dev')!;
    // индекс 1 (2026-06-02) занят обоими этапами
    expect(byDay.get(1)!.length).toBe(2);
  });

  it('считает дату релиза по последнему этапу', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Full',
          priority: 1,
          stages: [
            { id: 'a', type: 'architecture', durationDays: 1, assigneeId: 'lead' },
            { id: 'd', type: 'development', durationDays: 2, assigneeId: 'dev' },
            { id: 'r', type: 'review', durationDays: 1, assigneeId: 'lead' },
            { id: 'q', type: 'qa', durationDays: 1, assigneeId: 'qa' },
          ],
        },
      ],
      [emp('lead'), emp('dev'), emp('qa')],
    );
    const r = schedule(data);
    const q = r.scheduledStages.find((s) => s.stageId === 'q')!;
    expect(r.releases[0].qaEndIndex).toBe(q.endIndex);
  });
});
