// Понедельная загрузка по эпикам (эпик = задача планировщика) — данные для
// CSV-выгрузки менеджера. Строка — пара «задача × сотрудник», колонки — недели.
//
// Правила:
//  - Неделя — календарная, пн–пт; крайние недели периода могут быть неполными.
//  - Загрузка недели = занятые дни на этапах задачи / доступные дни сотрудника
//    в неделе (за вычетом отпусков). Наложение закреплённых этапов даёт в сумме
//    по строкам >100% — честная картина перегрузки.
//  - Завершённые задачи входят с пометкой done: люди были заняты, для
//    ретроспективного отчёта это важно (как в buildPeriodReport).
//  - Этапы без исполнителя не попадают: чьей-то загрузки за ними нет,
//    они видны отдельной секцией в отчёте за период.

import type { AppData, Specialization } from '../types';
import { SPECIALIZATION_ORDER } from '../types';
import type { ScheduleResult } from './scheduler';
import { parseISO, rangeToIndices } from './dates';

export interface ReportWeek {
  /** Первый и последний рабочий день недели, попавшие в период (ISO). */
  start: string;
  end: string;
  /** Границы недели в индексах рабочих дней горизонта (включительно). */
  firstIdx: number;
  lastIdx: number;
}

export interface WeeklyLoadRow {
  taskId: string;
  taskName: string;
  done: boolean;
  employeeId: string;
  employeeName: string;
  specialization: Specialization;
  /**
   * Доля загрузки по неделям, параллельно weeks. Обычно 0..1, может быть >1,
   * если наложились закреплённые этапы одной задачи. null — сотрудник
   * недоступен всю неделю и работы по задаче в ней нет.
   */
  load: (number | null)[];
}

export interface WeeklyLoadReport {
  from: string;
  to: string;
  weeks: ReportWeek[];
  /** Строки сгруппированы по задачам в порядке приоритета. */
  rows: WeeklyLoadRow[];
}

export function buildWeeklyLoadReport(
  data: AppData,
  result: ScheduleResult,
  from: string,
  to: string,
): WeeklyLoadReport {
  // Границы периода в индексах рабочих дней — как в buildPeriodReport:
  // ISO-даты сравниваются как строки, порядок совпадает с хронологическим.
  let fromIdx = -1;
  let toIdx = -2;
  for (let i = 0; i < result.days.length; i++) {
    const d = result.days[i];
    if (d < from) continue;
    if (d > to) break;
    if (fromIdx === -1) fromIdx = i;
    toIdx = i;
  }

  // Разбиение на недели. Рабочие дни идут по возрастанию с пропуском выходных,
  // поэтому новая неделя начинается там, где день недели не больше предыдущего
  // (пт → пн). Дни одной недели — непрерывный отрезок индексов.
  const weeks: ReportWeek[] = [];
  if (fromIdx >= 0) {
    let prevDow = 7;
    for (let i = fromIdx; i <= toIdx; i++) {
      const dow = parseISO(result.days[i]).getDay();
      if (dow <= prevDow) {
        weeks.push({
          start: result.days[i],
          end: result.days[i],
          firstIdx: i,
          lastIdx: i,
        });
      } else {
        const w = weeks[weeks.length - 1];
        w.end = result.days[i];
        w.lastIdx = i;
      }
      prevDow = dow;
    }
  }

  const dayToIndex = new Map<string, number>();
  result.days.forEach((d, i) => dayToIndex.set(d, i));

  // Доступные дни сотрудника по неделям: дни недели минус отпуска.
  const availableByEmployee = new Map<string, number[]>();
  for (const emp of data.employees) {
    const unavailable = new Set(
      emp.unavailable.flatMap((r) => rangeToIndices(r.from, r.to, dayToIndex)),
    );
    availableByEmployee.set(
      emp.id,
      weeks.map((w) => {
        let n = 0;
        for (let i = w.firstIdx; i <= w.lastIdx; i++) {
          if (!unavailable.has(i)) n++;
        }
        return n;
      }),
    );
  }

  // Занятые дни по парам «задача × сотрудник» и неделям.
  const busyByPair = new Map<string, number[]>();
  for (const s of result.scheduledStages) {
    if (!s.assigneeId || s.startIndex < 0) continue;
    if (s.startIndex > toIdx || s.endIndex < fromIdx) continue;
    const key = `${s.taskId}|${s.assigneeId}`;
    let acc = busyByPair.get(key);
    if (!acc) {
      acc = weeks.map(() => 0);
      busyByPair.set(key, acc);
    }
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi];
      const overlap =
        Math.min(s.endIndex, w.lastIdx) - Math.max(s.startIndex, w.firstIdx) + 1;
      if (overlap > 0) acc[wi] += overlap;
    }
  }

  // Сотрудники в порядке специализаций (как строки на ганте), внутри — по имени.
  const employees = [...data.employees].sort((a, b) => {
    const spec =
      SPECIALIZATION_ORDER.indexOf(a.specialization) -
      SPECIALIZATION_ORDER.indexOf(b.specialization);
    return spec !== 0 ? spec : a.name.localeCompare(b.name, 'ru');
  });

  // releases идут в порядке приоритета — он же порядок групп в отчёте.
  const rows: WeeklyLoadRow[] = [];
  for (const rel of result.releases) {
    for (const emp of employees) {
      const busy = busyByPair.get(`${rel.taskId}|${emp.id}`);
      if (!busy) continue;
      const available = availableByEmployee.get(emp.id)!;
      rows.push({
        taskId: rel.taskId,
        taskName: rel.taskName,
        done: rel.done,
        employeeId: emp.id,
        employeeName: emp.name,
        specialization: emp.specialization,
        load: weeks.map((w, wi) => {
          if (available[wi] > 0) return busy[wi] / available[wi];
          if (busy[wi] > 0) {
            // Закреплённый этап лёг на отпуск: доступных дней нет, но работа
            // назначена — считаем от полной недели, чтобы она не пропала.
            return busy[wi] / (w.lastIdx - w.firstIdx + 1);
          }
          return null; // весь отпуск, работы нет
        }),
      });
    }
  }

  return { from, to, weeks, rows };
}
