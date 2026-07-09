// Отчёт за период: срез плана для менеджера — кто чем занят, загрузка,
// какие задачи стартуют и завершаются в выбранные даты.
//
// Правила:
//  - Период задаётся датами включительно; учитываются только рабочие дни,
//    попавшие в расчётный горизонт (прошлое до начала горизонта не считаем).
//  - Загрузка считается по occupancy движка, поэтому этапы завершённых задач
//    входят в занятость (они продолжают занимать людей) и показываются в
//    списке с пометкой done — иначе цифры не сошлись бы со списком этапов.
//  - Стартующие/завершающиеся задачи и этапы без исполнителя — только по
//    задачам в работе (как в остальных выгрузках).

import type { AppData, Specialization, StageType } from '../types';
import { SPECIALIZATION_ORDER } from '../types';
import type { ScheduleResult, ScheduledStage } from './scheduler';
import { rangeToIndices } from './dates';

/** Порог недогрузки: занято меньше этой доли доступных дней периода. */
export const UNDERLOAD_THRESHOLD = 0.5;

/** Этап, попавший в период (даты этапа целиком, не обрезанные). */
export interface ReportStageEntry {
  taskId: string;
  taskName: string;
  type: StageType;
  startDate: string;
  endDate: string;
  /** Сколько рабочих дней этапа приходится на период. */
  daysInPeriod: number;
  /** Этап завершённой задачи (заморожен, но занимает человека). */
  done: boolean;
}

export type LoadStatus = 'overloaded' | 'underloaded' | 'normal';

export interface EmployeePeriodReport {
  employeeId: string;
  name: string;
  specialization: Specialization;
  /** Этапы сотрудника, пересекающие период, по дате начала. */
  stages: ReportStageEntry[];
  /** Доступных рабочих дней в периоде (за вычетом отпусков). */
  availableDays: number;
  /** Занятых рабочих дней в периоде. */
  busyDays: number;
  /** Свободных дней (доступные минус занятые, не меньше 0). */
  freeDays: number;
  /** Доля занятости 0..1 (может быть >1, если закреплённое легло на отпуск). */
  utilization: number;
  /** Дней с наложением этапов (>1 этап в день). */
  overloadDays: number;
  status: LoadStatus;
}

/** Задача в секциях «стартует» / «завершается». */
export interface ReportTaskEntry {
  taskId: string;
  taskName: string;
  /** Дата начала первого этапа (для секции стартующих). */
  startDate: string | null;
  qaEndDate: string | null;
  releaseDate: string | null;
}

export interface PeriodReport {
  from: string;
  to: string;
  /** Рабочих дней периода внутри расчётного горизонта. */
  totalDays: number;
  employees: EmployeePeriodReport[];
  /** Задачи, чей первый этап начинается в периоде. */
  starting: ReportTaskEntry[];
  /** Задачи с датой релиза в периоде. */
  finishing: ReportTaskEntry[];
  /** Этапы без исполнителя, попадающие в период. */
  unassigned: ReportStageEntry[];
}

export function buildPeriodReport(
  data: AppData,
  result: ScheduleResult,
  from: string,
  to: string,
): PeriodReport {
  const dayToIndex = new Map<string, number>();
  result.days.forEach((d, i) => dayToIndex.set(d, i));

  // Границы периода в индексах рабочих дней (обе включительно).
  // Даты ISO сравниваются как строки — лексикографический порядок совпадает
  // с хронологическим.
  let fromIdx = -1;
  let toIdx = -2;
  for (let i = 0; i < result.days.length; i++) {
    const d = result.days[i];
    if (d < from) continue;
    if (d > to) break;
    if (fromIdx === -1) fromIdx = i;
    toIdx = i;
  }
  const totalDays = fromIdx >= 0 ? toIdx - fromIdx + 1 : 0;

  const empty: PeriodReport = {
    from,
    to,
    totalDays: 0,
    employees: [],
    starting: [],
    finishing: [],
    unassigned: [],
  };
  if (totalDays === 0) return empty;

  const intersects = (s: ScheduledStage) =>
    s.startIndex >= 0 && s.startIndex <= toIdx && s.endIndex >= fromIdx;

  const toEntry = (s: ScheduledStage): ReportStageEntry => ({
    taskId: s.taskId,
    taskName: s.taskName,
    type: s.type,
    startDate: result.days[s.startIndex],
    endDate: result.days[s.endIndex],
    daysInPeriod:
      Math.min(s.endIndex, toIdx) - Math.max(s.startIndex, fromIdx) + 1,
    done: s.done,
  });

  // Сотрудники в порядке специализаций (как строки на ганте), внутри — по имени.
  const employees = [...data.employees]
    .sort((a, b) => {
      const spec =
        SPECIALIZATION_ORDER.indexOf(a.specialization) -
        SPECIALIZATION_ORDER.indexOf(b.specialization);
      return spec !== 0 ? spec : a.name.localeCompare(b.name, 'ru');
    })
    .map((emp): EmployeePeriodReport => {
      // Отпуска в периоде уменьшают доступные дни.
      const unavailable = new Set(
        emp.unavailable
          .flatMap((r) => rangeToIndices(r.from, r.to, dayToIndex))
          .filter((i) => i >= fromIdx && i <= toIdx),
      );
      const availableDays = totalDays - unavailable.size;

      let busyDays = 0;
      let overloadDays = 0;
      const occ = result.occupancy.get(emp.id);
      if (occ) {
        for (const [idx, list] of occ) {
          if (idx < fromIdx || idx > toIdx) continue;
          busyDays++;
          if (list.length > 1) overloadDays++;
        }
      }

      const stages = result.scheduledStages
        .filter((s) => s.assigneeId === emp.id && intersects(s))
        .sort((a, b) => a.startIndex - b.startIndex)
        .map(toEntry);

      const utilization = availableDays > 0 ? busyDays / availableDays : 0;
      const status: LoadStatus =
        overloadDays > 0
          ? 'overloaded'
          : availableDays > 0 && utilization < UNDERLOAD_THRESHOLD
            ? 'underloaded'
            : 'normal';

      return {
        employeeId: emp.id,
        name: emp.name,
        specialization: emp.specialization,
        stages,
        availableDays,
        busyDays,
        freeDays: Math.max(0, availableDays - busyDays),
        utilization,
        overloadDays,
        status,
      };
    });

  // Первый размещённый этап каждой задачи в работе — для секции стартующих.
  const firstStart = new Map<string, number>();
  for (const s of result.scheduledStages) {
    if (s.done || s.startIndex < 0) continue;
    const cur = firstStart.get(s.taskId);
    if (cur === undefined || s.startIndex < cur) firstStart.set(s.taskId, s.startIndex);
  }

  const starting = result.releases
    .filter((r) => !r.done)
    .flatMap((r): ReportTaskEntry[] => {
      const idx = firstStart.get(r.taskId);
      if (idx === undefined || idx < fromIdx || idx > toIdx) return [];
      return [
        {
          taskId: r.taskId,
          taskName: r.taskName,
          startDate: result.days[idx],
          qaEndDate: r.qaEndDate,
          releaseDate: r.releaseDate,
        },
      ];
    })
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  // Дата релиза — не обязательно рабочий день периода по индексам (вт/чт может
  // выпасть на день сразу за QA), поэтому сравниваем сами даты.
  const finishing = result.releases
    .filter(
      (r) => !r.done && r.releaseDate !== null && r.releaseDate >= from && r.releaseDate <= to,
    )
    .map(
      (r): ReportTaskEntry => ({
        taskId: r.taskId,
        taskName: r.taskName,
        startDate: firstStart.has(r.taskId)
          ? result.days[firstStart.get(r.taskId)!]
          : null,
        qaEndDate: r.qaEndDate,
        releaseDate: r.releaseDate,
      }),
    )
    .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));

  const unassigned = result.scheduledStages
    .filter((s) => !s.done && s.assigneeId === null && intersects(s))
    .sort((a, b) => a.startIndex - b.startIndex)
    .map(toEntry);

  return { from, to, totalDays, employees, starting, finishing, unassigned };
}
