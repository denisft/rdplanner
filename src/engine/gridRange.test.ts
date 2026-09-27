import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { gridDayCount } from './gridRange';
import type { AppData, Task } from '../types';

function plan(tasks: Task[]): AppData {
  // 2026-06-01 — понедельник, горизонт 4 недели = 20 рабочих дней.
  return {
    teams: [{ id: 'team-1', name: 'Команда 1' }],
    employees: [{ id: 'dev', name: 'dev', specialization: 'backend', unavailable: [] }],
    tasks,
    horizonStart: '2026-06-01',
    horizonWeeks: 4,
  };
}

describe('gridDayCount', () => {
  it('пустой план — ровно выбранный горизонт', () => {
    const data = plan([]);
    expect(gridDayCount(schedule(data), data.horizonWeeks)).toBe(20);
  });

  it('всё влезает в горизонт — сетка не растёт', () => {
    const data = plan([
      {
        id: 't',
        name: 'T',
        priority: 1,
        stages: [{ id: 's', type: 'development', durationDays: 5, assigneeId: 'dev' }],
      },
    ]);
    expect(gridDayCount(schedule(data), data.horizonWeeks)).toBe(20);
  });

  it('этап, закреплённый за горизонтом, виден целиком вместе с релизом', () => {
    const data = plan([
      {
        id: 't',
        name: 'T',
        priority: 1,
        stages: [
          // Пн 13 июля = индекс 30, три дня → конец в ср 15 июля (индекс 32),
          // релиз — чт 16 июля (индекс 33).
          {
            id: 's',
            type: 'development',
            durationDays: 3,
            assigneeId: 'dev',
            pinnedStartDate: '2026-07-13',
          },
        ],
      },
    ]);
    const result = schedule(data);
    const count = gridDayCount(result, data.horizonWeeks);
    // 34 дня до релиза включительно + неделя запаса, округлено до недели.
    expect(count).toBe(40);
    expect(count % 5).toBe(0);
    expect(result.days[count - 1] >= '2026-07-16').toBe(true);
  });

  it('не длиннее расчётной сетки движка', () => {
    const data = plan([]);
    const result = schedule(data);
    expect(gridDayCount(result, 1000)).toBe(result.days.length);
  });
});
