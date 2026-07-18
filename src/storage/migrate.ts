// Миграция сохранённых данных к текущей схеме (SCHEMA_VERSION).
//
// v1 → v2: появились команды. У старых планов нет ни `teams`, ни `teamId`
// у людей и задач — заворачиваем всё в одну дефолтную команду. Функция
// идемпотентна: на уже-v2 данных ничего не меняет, а частично заполненные
// (teamId, указывающий на несуществующую команду) чинит к первой команде.

import type { AppData, Team } from '../types';

/** Стабильный id дефолтной команды — чтобы миграция была детерминированной. */
export const DEFAULT_TEAM_ID = 'team-1';
const DEFAULT_TEAM_NAME = 'Команда 1';

export function migrateAppData(data: AppData): AppData {
  const teams: Team[] =
    Array.isArray(data.teams) && data.teams.length > 0
      ? data.teams
      : [{ id: DEFAULT_TEAM_ID, name: DEFAULT_TEAM_NAME }];

  // Люди и задачи без валидного teamId привязываются к первой команде.
  const known = new Set(teams.map((t) => t.id));
  const fallback = teams[0].id;
  const withTeam = <T extends { teamId?: string }>(item: T): T =>
    item.teamId && known.has(item.teamId) ? item : { ...item, teamId: fallback };

  return {
    ...data,
    teams,
    employees: data.employees.map(withTeam),
    tasks: data.tasks.map(withTeam),
  };
}
