import type { AppData, Employee, Task, Stage, StageType } from '../types';

// Данные плана команды на июнь 2026 — из протокола встречи по распределению задач.
// Этапы закреплены (pinnedStartDate) на даты из протокола, длительность — в рабочих днях.
// Роли: разработчики помечены как backend, тестировщики — qa (исходный протокол
// не разделяет бэк/фронт и не выделяет лидов).

let seq = 0;
const uid = (prefix: string) => `${prefix}-${++seq}`;

// Демо — одна команда; teamId проставляется людям и задачам ниже.
const TEAM_ID = 'team-1';

function e(name: string, specialization: Employee['specialization']): Employee {
  return { id: uid('emp'), name, specialization, teamId: TEAM_ID, unavailable: [] };
}

// --- Команда ---
const ali = e('Али', 'backend');
const alexandr = e('Александр С.', 'backend');
const vladislav = e('Владислав', 'backend');
const vladimir = e('Владимир Б.', 'backend');
const nikita = e('Никита К.', 'backend');
const ayrat = e('Айрат-Б', 'backend');
const yuliaB = e('Юлия Б.', 'qa');
const mariaS = e('Мария С.', 'qa');
const yuliaS = e('Юлия С.', 'qa');

export const sampleEmployees: Employee[] = [
  ali,
  alexandr,
  vladislav,
  vladimir,
  nikita,
  ayrat,
  yuliaB,
  mariaS,
  yuliaS,
];

// --- Этапы и задачи ---
function stage(
  type: StageType,
  durationDays: number,
  assigneeId: string | null,
  pinnedStartDate: string,
): Stage {
  return { id: uid('st'), type, durationDays, assigneeId, pinnedStartDate };
}

function task(name: string, priority: number, stages: Stage[]): Task {
  return { id: uid('task'), name, priority, stages, teamId: TEAM_ID };
}

export const sampleTasks: Task[] = [
  // Али: пересборка интеграции с каталогом (архитектура + разработка), 01.06–05.06.
  task('Пересборка интеграции с каталогом', 1, [
    stage('architecture', 2, ali.id, '2026-06-01'),
    stage('development', 3, ali.id, '2026-06-03'),
  ]),

  // Александр С.: архитектура переезда союзов (арх + разработка + ревью), 01.06–05.06.
  task('Архитектура переезда союзов', 1, [
    stage('architecture', 2, alexandr.id, '2026-06-01'),
    stage('development', 2, alexandr.id, '2026-06-03'),
    stage('review', 1, alexandr.id, '2026-06-05'),
  ]),

  // Починить фильтры складов: архитектура и реализация — Владислав, QA — Мария С.
  task('Починить фильтры складов', 1, [
    stage('architecture', 4, vladislav.id, '2026-06-08'),
    stage('development', 10, vladislav.id, '2026-06-15'),
    stage('qa', 7, mariaS.id, '2026-06-15'),
  ]),

  // Владимир Б.: переход на сервис фильтров и гейтвей (арх + разработка + ревью), 02.06–15.06.
  task('Переход на сервис фильтров и гейтвей', 1, [
    stage('architecture', 3, vladimir.id, '2026-06-02'),
    stage('development', 5, vladimir.id, '2026-06-05'),
    stage('review', 2, vladimir.id, '2026-06-12'),
  ]),

  // Владимир Б.: внешний источник подборок (реализация + ревью), 16.06–19.06.
  task('Внешний источник подборок', 2, [
    stage('development', 3, vladimir.id, '2026-06-16'),
    stage('review', 1, vladimir.id, '2026-06-19'),
  ]),

  // Никита К.: внешний источник подборок (репрайсеры), 15.06–18.06.
  task('Внешний источник подборок (репрайсеры)', 2, [
    stage('development', 4, nikita.id, '2026-06-15'),
  ]),

  // Никита К.: новый этап промиков в оформлении подборок (реализация), 01.06–11.06.
  task('Новый этап промиков в оформлении подборок', 1, [
    stage('development', 9, nikita.id, '2026-06-01'),
  ]),

  // Айрат-Б: фильтр наличия TN-WED в ЭЛО (реализация), 01.06–05.06.
  task('Фильтр наличия TN-WED в ЭЛО', 1, [
    stage('development', 5, ayrat.id, '2026-06-01'),
  ]),

  // Оптом дешевле для бизнеса — фильтр в подборках: арх + реализация + ревью — Айрат-Б, QA — Юлия С.
  task('Оптом дешевле для бизнеса (фильтр в подборках)', 2, [
    stage('architecture', 3, ayrat.id, '2026-06-09'),
    stage('development', 5, ayrat.id, '2026-06-12'),
    stage('review', 1, ayrat.id, '2026-06-19'),
    stage('qa', 4, yuliaS.id, '2026-06-22'),
  ]),

  // Юлия Б.: QA «Поток данных от аналитики по СПП РК», 15.06–23.06.
  task('Поток данных от аналитики по СПП РК', 2, [
    stage('qa', 7, yuliaB.id, '2026-06-15'),
  ]),
];

export function makeSampleData(): AppData {
  return {
    teams: [{ id: TEAM_ID, name: 'Команда 1' }],
    employees: sampleEmployees,
    tasks: sampleTasks,
    horizonStart: '2026-06-01',
    horizonWeeks: 4,
  };
}
