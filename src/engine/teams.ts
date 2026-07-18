// Срез плана по одной команде — то, что видит и с чем работает активная вкладка.
// Движок и все производные (гант, релизы, отчёт, шаринг, экспорт) считаются
// на этом срезе; полный AppData остаётся источником истины для setData/автосейва.
// Раз люди команд не пересекаются, срез эквивалентен отдельному прогону (инвариант
// в teams.test.ts).

import type { AppData } from '../types';

export function teamView(data: AppData, teamId: string): AppData {
  return {
    ...data,
    teams: data.teams.filter((t) => t.id === teamId),
    employees: data.employees.filter((e) => e.teamId === teamId),
    tasks: data.tasks.filter((t) => t.teamId === teamId),
  };
}
