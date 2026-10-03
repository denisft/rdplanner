import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import { pastViewStart, shiftHorizonStart, shiftTarget } from './horizon';
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

describe('просмотр прошлого (gridStart)', () => {
  // План после сдвига: Straddle и Pinned начаты до границы, After — после.
  const shifted = () => {
    const data = livePlan();
    return shiftHorizonStart(data, schedule(data), NEW_START);
  };
  const startDate = (r: ReturnType<typeof schedule>, stageId: string) => {
    const s = r.scheduledStages.find((x) => x.stageId === stageId)!;
    return s.startIndex >= 0 ? r.days[s.startIndex] : null;
  };
  const endDate = (r: ReturnType<typeof schedule>, stageId: string) => {
    const s = r.scheduledStages.find((x) => x.stageId === stageId)!;
    return s.endIndex >= 0 ? r.days[s.endIndex] : null;
  };

  it('pastViewStart — понедельник недели самого раннего прошлого этапа', () => {
    expect(pastViewStart(shifted())).toBe('2026-06-01');
    expect(pastViewStart(livePlan())).toBeNull(); // до начала плана ничего нет
  });

  it('прошлые этапы видны на своих датах целиком', () => {
    const data = shifted();
    const past = schedule(data, { gridStart: '2026-06-01' });
    expect(past.days[0]).toBe('2026-06-01');
    expect(past.days[past.planStartIndex]).toBe(NEW_START);
    expect(startDate(past, 'a1')).toBe('2026-06-01');
    expect(past.scheduledStages.find((s) => s.stageId === 'a1')!.clippedStart).toBeUndefined();
    expect(startDate(past, 'c1')).toBe('2026-06-10');
  });

  it('инвариант: план не меняется — те же релизы и те же даты этапов', () => {
    const data = shifted();
    const normal = schedule(data);
    const past = schedule(data, { gridStart: '2026-06-01' });
    for (const r of normal.releases) {
      expect(past.releases.find((x) => x.taskId === r.taskId)!.releaseDate).toBe(
        r.releaseDate,
      );
    }
    for (const s of normal.scheduledStages) {
      expect(endDate(past, s.stageId)).toBe(endDate(normal, s.stageId));
      if (!s.clippedStart) {
        expect(startDate(past, s.stageId)).toBe(startDate(normal, s.stageId));
      }
    }
  });

  it('авторазмещение не заходит левее начала плана, даже если там свободно', () => {
    const data = base(
      [
        {
          id: 't',
          name: 'Auto',
          priority: 1,
          stages: [{ id: 's', type: 'development', durationDays: 3, assigneeId: 'dev' }],
        },
      ],
      [emp('dev')],
    );
    const past = schedule(data, { gridStart: '2026-05-18' });
    expect(startDate(past, 's')).toBe('2026-06-01');
  });

  it('целиком прожитая задача возвращается на гант', () => {
    const data = base(
      [
        {
          id: 'past',
          name: 'Lived',
          priority: 1,
          stages: [{ id: 'p1', type: 'development', durationDays: 5, assigneeId: 'dev' }],
        },
      ],
      [emp('dev')],
    );
    const before = schedule(data);
    const moved = shiftHorizonStart(data, before, NEW_START);
    const past = schedule(moved, { gridStart: pastViewStart(moved)! });
    expect(startDate(past, 'p1')).toBe('2026-06-01');
    expect(past.releases[0].releaseDate).toBe(before.releases[0].releaseDate);
  });

  it('gridStart не раньше начала плана игнорируется', () => {
    const data = livePlan();
    const r = schedule(data, { gridStart: '2026-07-01' });
    expect(r.days[0]).toBe(data.horizonStart);
    expect(r.planStartIndex).toBe(0);
  });
});

describe('shiftTarget', () => {
  it('возвращает понедельник предыдущей недели', () => {
    expect(shiftTarget('2026-07-15')).toBe('2026-07-06'); // среда
    expect(shiftTarget('2026-07-13')).toBe('2026-07-06'); // понедельник
    expect(shiftTarget('2026-07-19')).toBe('2026-07-06'); // воскресенье
  });
});
