import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { shiftHorizonStart, shiftTarget } from './horizon';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { teams: [{ id: 'team-1', name: 'Команда 1' }], employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

// Типовой живой план: одна задача идёт через будущую границу сдвига,
// одна целиком после неё, одна закреплена руками до границы.
function livePlan(): AppData {
  return base(
    [
      {
        id: 'a',
        name: 'Straddle',
        priority: 1,
        stages: [
          // 15 рабочих дней с 2026-06-01 → через границу 2026-06-15.
          { id: 'a1', type: 'development', durationDays: 15, assigneeId: 'dev' },
        ],
      },
      {
        id: 'b',
        name: 'After',
        priority: 2,
        stages: [
          // Встаёт следом за Straddle — целиком после границы.
          { id: 'b1', type: 'development', durationDays: 5, assigneeId: 'dev' },
        ],
      },
      {
        id: 'c',
        name: 'Pinned',
        priority: 3,
        stages: [
          // Закреплён руками до границы, хвост переживает сдвиг.
          {
            id: 'c1',
            type: 'development',
            durationDays: 5,
            assigneeId: 'dev2',
            pinnedStartDate: '2026-06-10',
          },
        ],
      },
    ],
    [emp('dev'), emp('dev2')],
  );
}

const NEW_START = '2026-06-15'; // понедельник, 10 рабочих дней от начала

describe('shiftHorizonStart', () => {
  it('инвариант: даты релизов активных задач не меняются', () => {
    const data = livePlan();
    const before = schedule(data);
    const after = schedule(shiftHorizonStart(data, before, NEW_START));

    const releasesBefore = new Map(
      before.releases.map((r) => [r.taskId, r.releaseDate]),
    );
    for (const r of after.releases) {
      expect(r.releaseDate).toBe(releasesBefore.get(r.taskId));
    }
    // И перегрузок сдвиг не породил.
    for (const [, byDay] of after.occupancy)
      for (const [, list] of byDay) expect(list.length).toBeLessThanOrEqual(1);
  });

  it('этапы, начинающиеся до границы, закрепляются на своих датах', () => {
    const data = livePlan();
    const shifted = shiftHorizonStart(data, schedule(data), NEW_START);
    const a1 = shifted.tasks.find((t) => t.id === 'a')!.stages[0];
    expect(a1.pinnedStartDate).toBe('2026-06-01');
    expect(shifted.horizonStart).toBe(NEW_START);
  });

  it('уже закреплённые этапы не перезакрепляются', () => {
    const data = livePlan();
    const shifted = shiftHorizonStart(data, schedule(data), NEW_START);
    const c1 = shifted.tasks.find((t) => t.id === 'c')!.stages[0];
    expect(c1.pinnedStartDate).toBe('2026-06-10'); // как было
  });

  it('этапы после границы остаются в авторежиме', () => {
    const data = livePlan();
    const shifted = shiftHorizonStart(data, schedule(data), NEW_START);
    const b1 = shifted.tasks.find((t) => t.id === 'b')!.stages[0];
    expect(b1.pinnedStartDate).toBeUndefined();
  });

  it('этап без исполнителя не закрепляется', () => {
    const data = base(
      [
        {
          id: 't',
          name: 'No assignee',
          priority: 1,
          stages: [
            { id: 's', type: 'development', durationDays: 3, assigneeId: null },
          ],
        },
      ],
      [emp('dev')],
    );
    const shifted = shiftHorizonStart(data, schedule(data), NEW_START);
    expect(shifted.tasks[0].stages[0].pinnedStartDate).toBeUndefined();
  });

  it('завершённая задача целиком в прошлом исчезает с ганта после сдвига', () => {
    const data = base(
      [
        {
          id: 'done',
          name: 'Old done',
          priority: 1,
          done: true,
          completedAt: '2026-06-03',
          stages: [
            {
              id: 'sd',
              type: 'development',
              durationDays: 2,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-01', // заморожена completeTask
            },
          ],
        },
        {
          id: 'live',
          name: 'Live',
          priority: 1,
          stages: [
            {
              id: 'sl',
              type: 'development',
              durationDays: 3,
              assigneeId: 'dev',
              pinnedStartDate: '2026-06-16',
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const before = schedule(data);
    const after = schedule(shiftHorizonStart(data, before, NEW_START));

    const doneStage = after.scheduledStages.find((s) => s.stageId === 'sd')!;
    expect(doneStage.startIndex).toBe(-1); // с ганта исчезла
    // Релиз живой задачи не изменился.
    expect(after.releases.find((r) => r.taskId === 'live')!.releaseDate).toBe(
      before.releases.find((r) => r.taskId === 'live')!.releaseDate,
    );
  });

  it('активная задача целиком в прошлом исчезает с ганта, но дата релиза остаётся', () => {
    const data = base(
      [
        {
          id: 'past',
          name: 'Lived',
          priority: 1,
          stages: [
            // 5 рабочих дней с 2026-06-01 → целиком до границы 2026-06-15.
            { id: 'p1', type: 'development', durationDays: 5, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const before = schedule(data);
    const after = schedule(shiftHorizonStart(data, before, NEW_START));

    const rel = after.releases[0];
    expect(rel.qaEndIndex).toBe(-1); // на ганте задачи больше нет
    expect(rel.qaEndDate).toBe(before.releases[0].qaEndDate); // 2026-06-05
    expect(rel.releaseDate).toBe(before.releases[0].releaseDate); // 2026-06-09
  });

  it('исходные данные не мутируют', () => {
    const data = livePlan();
    const snapshot = JSON.stringify(data);
    shiftHorizonStart(data, schedule(data), NEW_START);
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it('повторный сдвиг на ту же дату ничего не меняет', () => {
    const data = livePlan();
    const once = shiftHorizonStart(data, schedule(data), NEW_START);
    const twice = shiftHorizonStart(once, schedule(once), NEW_START);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('shiftTarget', () => {
  it('возвращает понедельник предыдущей недели', () => {
    expect(shiftTarget('2026-07-15')).toBe('2026-07-06'); // среда
    expect(shiftTarget('2026-07-13')).toBe('2026-07-06'); // понедельник
    expect(shiftTarget('2026-07-19')).toBe('2026-07-06'); // воскресенье
  });
});
