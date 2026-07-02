// Движок планирования: жадное размещение этапов во времени.
//
// Правила (зафиксированы в PRD):
//  - КТО решает пользователь (этап.assigneeId). Движок решает только КОГДА.
//  - Этапы внутри задачи строго последовательны: следующий не раньше окончания предыдущего.
//  - Человек занят максимум одним этапом в день; этап кладётся непрерывным блоком
//    в ближайший свободный слот назначенного человека (дробление — только вручную).
//  - Недоступные дни (отпуск/больничный) исключаются из свободных слотов.
//  - Конфликт двух задач за одного человека решается приоритетом (меньше число = выше).
//  - Не влезает в горизонт — дата релиза просто едет вправо (этап не теряется).

import type { AppData, StageType } from '../types';
import { generateWorkingDays, nextReleaseDay, rangeToIndices } from './dates';

/** На сколько рабочих дней вперёд строим расписание (запас за горизонтом для «сдвига вправо»). */
const SCHEDULING_HORIZON_DAYS = 260; // ~52 недели

export interface ScheduledStage {
  stageId: string;
  taskId: string;
  taskName: string;
  type: StageType;
  assigneeId: string | null;
  priority: number;
  /** Индексы рабочих дней (включительно). -1 если разместить не удалось. */
  startIndex: number;
  endIndex: number;
  /** true — этап закреплён вручную (перетащен пользователем). */
  pinned: boolean;
}

export interface TaskRelease {
  taskId: string;
  taskName: string;
  /** Индекс рабочего дня окончания QA (конец последнего этапа). */
  qaEndIndex: number;
  /** Дата окончания QA. */
  qaEndDate: string | null;
  /** Дата релиза — ближайший вт/чт строго после окончания QA. */
  releaseDate: string | null;
}

export interface ScheduleResult {
  /** Рабочие дни (ISO) по индексам. */
  days: string[];
  scheduledStages: ScheduledStage[];
  releases: TaskRelease[];
  /** employeeId -> (dayIndex -> список stageId, занявших день). >1 = перегрузка. */
  occupancy: Map<string, Map<number, string[]>>;
  warnings: string[];
}

/** Ищет ближайший непрерывный блок длины `length`, свободный от занятости и недоступности. */
function findSlot(
  busy: Set<number>,
  unavailable: Set<number>,
  earliest: number,
  length: number,
  maxIndex: number,
): number {
  for (let start = Math.max(0, earliest); start + length <= maxIndex; start++) {
    let ok = true;
    for (let d = start; d < start + length; d++) {
      if (busy.has(d) || unavailable.has(d)) {
        start = d; // следующая итерация начнёт с d+1
        ok = false;
        break;
      }
    }
    if (ok) return start;
  }
  return -1;
}

export function schedule(data: AppData): ScheduleResult {
  const days = generateWorkingDays(data.horizonStart, SCHEDULING_HORIZON_DAYS);
  const maxIndex = days.length;
  const dayToIndex = new Map<string, number>();
  days.forEach((d, i) => dayToIndex.set(d, i));

  // Недоступность по сотрудникам -> множества индексов.
  const unavailableByEmployee = new Map<string, Set<number>>();
  for (const emp of data.employees) {
    const set = new Set<number>();
    for (const r of emp.unavailable) {
      for (const idx of rangeToIndices(r.from, r.to, dayToIndex)) set.add(idx);
    }
    unavailableByEmployee.set(emp.id, set);
  }

  // Занятость по сотрудникам (накапливается по мере размещения).
  const busyByEmployee = new Map<string, Set<number>>();
  const occupancy = new Map<string, Map<number, string[]>>();
  const ensureBusy = (id: string) => {
    let s = busyByEmployee.get(id);
    if (!s) {
      s = new Set<number>();
      busyByEmployee.set(id, s);
    }
    return s;
  };
  const markOccupied = (id: string, idx: number, stageId: string) => {
    let m = occupancy.get(id);
    if (!m) {
      m = new Map<number, string[]>();
      occupancy.set(id, m);
    }
    const list = m.get(idx) ?? [];
    list.push(stageId);
    m.set(idx, list);
  };

  // Задачи в порядке приоритета (меньше число = раньше), при равенстве — порядок ввода.
  const orderedTasks = data.tasks
    .map((task, order) => ({ task, order }))
    .sort((a, b) =>
      a.task.priority !== b.task.priority
        ? a.task.priority - b.task.priority
        : a.order - b.order,
    )
    .map((x) => x.task);

  const scheduledStages: ScheduledStage[] = [];
  const releases: TaskRelease[] = [];
  const warnings: string[] = [];

  // Проход 1: резервируем все закреплённые вручную этапы, чтобы авторазмещение
  // могло обтекать их. Закреплённые блоки могут пересекаться — это покажет перегрузку.
  const pinned = new Map<string, { start: number; end: number }>();
  for (const task of data.tasks) {
    for (const stage of task.stages) {
      if (!stage.assigneeId || !stage.pinnedStartDate) continue;
      const start = dayToIndex.get(stage.pinnedStartDate);
      if (start === undefined) continue; // дата вне горизонта — упадёт в авторежим
      const end = start + stage.durationDays - 1;
      pinned.set(stage.id, { start, end });
      const busy = ensureBusy(stage.assigneeId);
      for (let d = start; d <= end && d < maxIndex; d++) {
        busy.add(d);
        markOccupied(stage.assigneeId, d, stage.id);
      }
    }
  }

  // Проход 2: размещаем по порядку приоритета, обтекая закреплённые этапы.
  for (const task of orderedTasks) {
    let prevEnd = -1; // индекс окончания предыдущего этапа
    let taskEnd = -1;

    for (const stage of task.stages) {
      const earliest = prevEnd + 1;
      const pin = pinned.get(stage.id);
      let startIndex: number;
      let isPinned = false;

      if (pin) {
        // Закреплён вручную — стоит ровно там (уже зарезервирован в проходе 1).
        startIndex = pin.start;
        isPinned = true;
      } else if (stage.assigneeId) {
        const busy = ensureBusy(stage.assigneeId);
        const unavailable =
          unavailableByEmployee.get(stage.assigneeId) ?? new Set<number>();
        startIndex = findSlot(
          busy,
          unavailable,
          earliest,
          stage.durationDays,
          maxIndex,
        );
        if (startIndex === -1) {
          warnings.push(
            `Не удалось разместить этап «${stage.type}» задачи «${task.name}» в пределах расчётного горизонта.`,
          );
        } else {
          for (let d = startIndex; d < startIndex + stage.durationDays; d++) {
            busy.add(d);
            markOccupied(stage.assigneeId, d, stage.id);
          }
        }
      } else {
        // Без исполнителя ресурсного ограничения нет — кладём сразу после предыдущего.
        startIndex = earliest;
        warnings.push(
          `Этап «${stage.type}» задачи «${task.name}» без исполнителя — учтён по времени, но не занимает ничью загрузку.`,
        );
      }

      const endIndex =
        startIndex === -1 ? -1 : startIndex + stage.durationDays - 1;

      scheduledStages.push({
        stageId: stage.id,
        taskId: task.id,
        taskName: task.name,
        type: stage.type,
        assigneeId: stage.assigneeId,
        priority: task.priority,
        startIndex,
        endIndex,
        pinned: isPinned,
      });

      if (endIndex >= 0) {
        prevEnd = endIndex;
        taskEnd = Math.max(taskEnd, endIndex);
      }
    }

    const qaEndDate = taskEnd >= 0 ? days[taskEnd] : null;
    releases.push({
      taskId: task.id,
      taskName: task.name,
      qaEndIndex: taskEnd,
      qaEndDate,
      releaseDate: qaEndDate ? nextReleaseDay(qaEndDate) : null,
    });
  }

  return { days, scheduledStages, releases, occupancy, warnings };
}

/** Список индексов с перегрузкой (>1 этап в день) по сотруднику. */
export function overloadedDays(
  occupancy: Map<string, Map<number, string[]>>,
  employeeId: string,
): Set<number> {
  const result = new Set<number>();
  const m = occupancy.get(employeeId);
  if (!m) return result;
  for (const [idx, list] of m) {
    if (list.length > 1) result.add(idx);
  }
  return result;
}
