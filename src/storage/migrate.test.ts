import { describe, it, expect } from 'vitest';
import { migrateAppData, DEFAULT_TEAM_ID } from './migrate';
import type { AppData } from '../types';

// v1-план: без teams и без teamId у людей и задач (как лежало на диске до v2).
function v1(): AppData {
  return {
    // teams в старой схеме не было — специально пропускаем через as.
    teams: undefined as unknown as AppData['teams'],
    employees: [
      { id: 'e1', name: 'Аня', specialization: 'backend', unavailable: [] },
    ],
    tasks: [
      {
        id: 't1',
        name: 'Задача',
        priority: 1,
        stages: [{ id: 's1', type: 'development', durationDays: 2, assigneeId: 'e1' }],
      },
    ],
    horizonStart: '2026-06-01',
    horizonWeeks: 4,
  };
}

describe('migrateAppData', () => {
  it('v1 → v2: создаёт дефолтную команду и привязывает к ней людей и задачи', () => {
    const m = migrateAppData(v1());
    expect(m.teams).toHaveLength(1);
    expect(m.teams[0].id).toBe(DEFAULT_TEAM_ID);
    expect(m.employees.every((e) => e.teamId === DEFAULT_TEAM_ID)).toBe(true);
    expect(m.tasks.every((t) => t.teamId === DEFAULT_TEAM_ID)).toBe(true);
  });

  it('идемпотентна: повторная миграция ничего не меняет', () => {
    const once = migrateAppData(v1());
    const twice = migrateAppData(once);
    expect(twice).toEqual(once);
  });

  it('сохраняет валидные команды и teamId (уже v2)', () => {
    const data: AppData = {
      teams: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      employees: [
        { id: 'e1', name: 'Аня', specialization: 'backend', teamId: 'b', unavailable: [] },
      ],
      tasks: [
        { id: 't1', name: 'Задача', teamId: 'b', priority: 1, stages: [] },
      ],
      horizonStart: '2026-06-01',
      horizonWeeks: 4,
    };
    const m = migrateAppData(data);
    expect(m.teams).toHaveLength(2);
    expect(m.employees[0].teamId).toBe('b');
    expect(m.tasks[0].teamId).toBe('b');
  });

  it('чинит teamId, указывающий на несуществующую команду, — к первой', () => {
    const data: AppData = {
      teams: [{ id: 'a', name: 'A' }],
      employees: [
        { id: 'e1', name: 'Аня', specialization: 'backend', teamId: 'zzz', unavailable: [] },
      ],
      tasks: [{ id: 't1', name: 'Задача', teamId: 'zzz', priority: 1, stages: [] }],
      horizonStart: '2026-06-01',
      horizonWeeks: 4,
    };
    const m = migrateAppData(data);
    expect(m.employees[0].teamId).toBe('a');
    expect(m.tasks[0].teamId).toBe('a');
  });
});
