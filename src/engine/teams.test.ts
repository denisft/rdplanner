import { describe, it, expect } from 'vitest';
import { schedule } from './scheduler';
import type { AppData, Employee, Task } from '../types';

// Инвариант варианта A (см. ADR-001): движок не знает про команды. Пока люди
// не пересекаются между командами, единый прогон schedule() на всех данных
// даёт то же размещение, что и раздельные прогоны по каждой команде. Это
// обоснование того, что «два ганта» — фильтрация вида, а не второй движок.

function emp(id: string, teamId: string): Employee {
  return { id, name: id, specialization: 'backend', teamId, unavailable: [] };
}

function devTask(id: string, priority: number, assigneeId: string, teamId: string): Task {
  return {
    id,
    name: id,
    teamId,
    priority,
    stages: [{ id: `${id}-s`, type: 'development', durationDays: 3, assigneeId }],
  };
}

function makeData(teams: string[], employees: Employee[], tasks: Task[]): AppData {
  return {
    teams: teams.map((id) => ({ id, name: id })),
    employees,
    tasks,
    horizonStart: '2026-06-01',
    horizonWeeks: 4,
  };
}

/** Карта stageId → [startIndex, endIndex] из результата планирования. */
function placement(data: AppData): Map<string, [number, number]> {
  const r = schedule(data);
  return new Map(r.scheduledStages.map((s) => [s.stageId, [s.startIndex, s.endIndex]]));
}

describe('команды: раздельные наборы людей', () => {
  it('единый прогон совпадает с раздельными (люди не пересекаются)', () => {
    // Команда A: два человека, две конкурирующие за одного человека задачи.
    const a1 = emp('a1', 'A');
    const a2 = emp('a2', 'A');
    // Команда B: свой человек, свои задачи.
    const b1 = emp('b1', 'B');

    const tasksA = [
      devTask('ta1', 1, 'a1', 'A'),
      devTask('ta2', 2, 'a1', 'A'), // конкурирует с ta1 за a1
      devTask('ta3', 1, 'a2', 'A'),
    ];
    const tasksB = [
      devTask('tb1', 1, 'b1', 'B'),
      devTask('tb2', 2, 'b1', 'B'), // конкурирует с tb1 за b1
    ];

    const combined = placement(
      makeData(['A', 'B'], [a1, a2, b1], [...tasksA, ...tasksB]),
    );
    const onlyA = placement(makeData(['A'], [a1, a2], tasksA));
    const onlyB = placement(makeData(['B'], [b1], tasksB));

    for (const [stageId, pos] of onlyA) {
      expect(combined.get(stageId)).toEqual(pos);
    }
    for (const [stageId, pos] of onlyB) {
      expect(combined.get(stageId)).toEqual(pos);
    }
  });
});
