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
//
// Помимо расписания движок возвращает причины размещения (`reasons`, БЛ-1):
// объяснение собирается в момент укладки этапа, а не восстанавливается потом,
// иначе оно начнёт расходиться с фактическим расписанием.

import type { AppData, Employee, StageType } from '../types';
import {
  addWorkingDays,
  generateWorkingDays,
  nextReleaseDay,
  rangeToIndices,
  workingDaysBefore,
} from './dates';

/**
 * Пересекается ли непрерывный блок этапа (старт startISO, durationDays рабочих
 * дней) с недоступностью сотрудника. Используется как запрет ручного
 * закрепления поверх отпуска/больничного — авторазмещение такие дни и так
 * обходит, а перетаскиванием этап не должен «вставать в отпуск».
 */
export function stageOverlapsUnavailable(
  emp: Employee,
  startISO: string,
  durationDays: number,
): boolean {
  const block = generateWorkingDays(startISO, durationDays);
  return emp.unavailable.some((r) => block.some((d) => d >= r.from && d <= r.to));
}

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
  /** true — задача завершена (блок рисуется приглушённым и не двигается). */
  done: boolean;
  /** true — этап начат до начала горизонта: рисуется от левого края с
      обрезкой, реальный старт — в pinnedStartDate этапа. */
  clippedStart?: boolean;
}

/**
 * Блокирующий фактор: что помешало этапу начаться раньше. Даты — ISO,
 * диапазоны включительные. Человеческие формулировки — в `explain.ts`
 * (движок отдаёт факты, не текст).
 */
export type PlacementFactor =
  /** Предыдущий этап той же задачи (этапы строго последовательны). */
  | { kind: 'prevStage'; stageId: string; stageType: StageType; endDate: string }
  /** Мягкая нижняя граница старта задачи (task.earliestStart). */
  | { kind: 'earliestStart'; date: string }
  /** Исполнитель занят другим этапом. pinned — тот этап закреплён вручную
      (тот самый «обтекаемый пин» из требования). */
  | {
      kind: 'busy';
      stageId: string;
      taskId: string;
      taskName: string;
      stageType: StageType;
      pinned: boolean;
      from: string;
      to: string;
    }
  /** Недоступность исполнителя: отпуск, больничный. */
  | { kind: 'unavailable'; from: string; to: string }
  /** Дни были свободны, но непрерывного окна под длительность не хватило. */
  | { kind: 'shortGap'; freeDays: number; neededDays: number }
  /** У этапа нет исполнителя: учтён по времени, ничью загрузку не занимает. */
  | { kind: 'noAssignee' }
  /** Этап стоит здесь, потому что закреплён вручную. */
  | { kind: 'manualPin'; date: string }
  /** Разместить в пределах расчётного горизонта не удалось. */
  | { kind: 'noSlot' };

/** Наложение с другим этапом того же человека (перегрузка, красные дни). */
export interface StageConflict {
  stageId: string;
  taskId: string;
  taskName: string;
  stageType: StageType;
  /** Закреплён ли вручную этап, с которым произошло наложение. */
  pinned: boolean;
  from: string;
  to: string;
}

/** Объяснение размещения одного этапа. */
export interface StagePlacement {
  /** Дата старта (null — разместить не удалось). */
  startDate: string | null;
  /** Что помешало начать раньше, в хронологическом порядке. Пусто — ничего. */
  factors: PlacementFactor[];
  /** С кем этап наложился (A.3). Пусто — наложений нет. */
  conflicts: StageConflict[];
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
  /** true — задача завершена (в таблице уходит в секцию архива). */
  done: boolean;
}

export interface ScheduleResult {
  /** Рабочие дни (ISO) по индексам. */
  days: string[];
  scheduledStages: ScheduledStage[];
  releases: TaskRelease[];
  /** employeeId -> (dayIndex -> список stageId, занявших день). >1 = перегрузка. */
  occupancy: Map<string, Map<number, string[]>>;
  /** stageId -> почему этап стоит именно здесь (БЛ-1). */
  reasons: Map<string, StagePlacement>;
  warnings: string[];
}

/**
 * Ищет ближайший непрерывный блок длины `length`, свободный от занятости и
 * недоступности. `blockedDays` (если передан) собирает дни, из-за которых не
 * подошли более ранние старты, — по одному разу и по возрастанию: это сырьё
 * для объяснения размещения.
 */
function findSlot(
  busy: Set<number>,
  unavailable: Set<number>,
  earliest: number,
  length: number,
  maxIndex: number,
  blockedDays?: number[],
): number {
  for (let start = Math.max(0, earliest); start + length <= maxIndex; start++) {
    let ok = true;
    for (let d = start; d < start + length; d++) {
      if (busy.has(d) || unavailable.has(d)) {
        blockedDays?.push(d);
        start = d; // следующая итерация начнёт с d+1
        ok = false;
        break;
      }
    }
    if (ok) return start;
  }
  return -1;
}

/** Список индексов -> непрерывные диапазоны (порядок и дубликаты не важны). */
function toRuns(indices: number[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  for (const idx of [...indices].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && idx <= last.to + 1) last.to = Math.max(last.to, idx);
    else runs.push({ from: idx, to: idx });
  }
  return runs;
}

export function schedule(data: AppData): ScheduleResult {
  const days = generateWorkingDays(data.horizonStart, SCHEDULING_HORIZON_DAYS);
  const maxIndex = days.length;
  const dayToIndex = new Map<string, number>();
  days.forEach((d, i) => dayToIndex.set(d, i));
  /** Дата по индексу с защитой от выхода за расчётную сетку. */
  const dayAt = (idx: number): string =>
    days[Math.max(0, Math.min(idx, maxIndex - 1))];

  // Индекс первого рабочего дня не раньше даты — для мягкой границы старта
  // (task.earliestStart). Дата раньше начала сетки → 0 (границы нет),
  // позже конца сетки → maxIndex (в видимую сетку не влезет, уедет вправо).
  const floorIndexOf = (dateISO: string): number => {
    if (dateISO <= days[0]) return 0;
    const i = days.findIndex((d) => d >= dateISO);
    return i < 0 ? maxIndex : i;
  };

  // Паспорт этапа для объяснений: чей он и закреплён ли вручную.
  const stageMeta = new Map<
    string,
    { taskId: string; taskName: string; stageType: StageType; pinned: boolean }
  >();
  for (const task of data.tasks) {
    for (const stage of task.stages) {
      stageMeta.set(stage.id, {
        taskId: task.id,
        taskName: task.name,
        stageType: stage.type,
        pinned: !!stage.pinnedStartDate,
      });
    }
  }

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

  /**
   * Заблокированные дни -> факторы. Причину каждого дня берём из того же
   * состояния, которым руководствовался движок: отпуск — из недоступности,
   * занятость — из occupancy (там лежит ровно то, что уже размещено).
   * Соседние дни с одной причиной сливаются в диапазон.
   */
  const blockersToFactors = (
    blocked: number[],
    unavailable: Set<number>,
    empId: string,
  ): PlacementFactor[] => {
    const byCause = new Map<string, number[]>();
    const push = (key: string, idx: number) => {
      const list = byCause.get(key) ?? [];
      list.push(idx);
      byCause.set(key, list);
    };
    const occ = occupancy.get(empId);
    for (const d of blocked) {
      if (unavailable.has(d)) {
        push('unavailable', d);
        continue;
      }
      const list = occ?.get(d) ?? [];
      // Пустой список невозможен (день чем-то занят), но подстраховка дешевле
      // молчаливой дыры в объяснении.
      if (list.length === 0) push('unavailable', d);
      for (const sid of list) push('busy:' + sid, d);
    }

    const collected: { at: number; factor: PlacementFactor }[] = [];
    for (const [key, indices] of byCause) {
      for (const run of toRuns(indices)) {
        const from = dayAt(run.from);
        const to = dayAt(run.to);
        if (key === 'unavailable') {
          collected.push({ at: run.from, factor: { kind: 'unavailable', from, to } });
          continue;
        }
        const sid = key.slice('busy:'.length);
        const meta = stageMeta.get(sid);
        if (!meta) continue;
        collected.push({
          at: run.from,
          factor: {
            kind: 'busy',
            stageId: sid,
            taskId: meta.taskId,
            taskName: meta.taskName,
            stageType: meta.stageType,
            pinned: meta.pinned,
            from,
            to,
          },
        });
      }
    }
    return collected.sort((a, b) => a.at - b.at).map((c) => c.factor);
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
  const reasons = new Map<string, StagePlacement>();

  // Проход 1: резервируем все закреплённые вручную этапы, чтобы авторазмещение
  // могло обтекать их. Закреплённые блоки могут пересекаться — это покажет перегрузку.
  const pinned = new Map<
    string,
    { start: number; end: number; clipped: boolean }
  >();
  for (const task of data.tasks) {
    for (const stage of task.stages) {
      if (!stage.assigneeId || !stage.pinnedStartDate) continue;
      let start = dayToIndex.get(stage.pinnedStartDate);
      let clipped = false;
      if (start === undefined) {
        // Будущее за расчётной сеткой или выходной — как раньше, авторежим.
        if (stage.pinnedStartDate >= days[0]) continue;
        // Прошлое прожито: прожитая часть отрезается, хвост остаётся на своих
        // датах и занимает исполнителя. Целиком прошедший этап — в проход 2.
        const lived = workingDaysBefore(stage.pinnedStartDate, days[0]);
        if (stage.durationDays - lived <= 0) continue;
        start = -lived; // виртуальный старт до сетки; занимаем только дни >= 0
        clipped = true;
      }
      const end = start + stage.durationDays - 1;
      pinned.set(stage.id, { start: Math.max(0, start), end, clipped });
      const busy = ensureBusy(stage.assigneeId);
      for (let d = Math.max(0, start); d <= end && d < maxIndex; d++) {
        busy.add(d);
        markOccupied(stage.assigneeId, d, stage.id);
      }
    }
  }

  // Проход 2: размещаем по порядку приоритета, обтекая закреплённые этапы.
  for (const task of orderedTasks) {
    const done = !!task.done;
    // Мягкая граница старта: незакреплённые этапы не размещаются раньше неё.
    // Существующие задачи без earliestStart её не имеют — их раскладка не меняется.
    const startFloor = task.earliestStart ? floorIndexOf(task.earliestStart) : 0;
    let prevEnd = -1; // индекс окончания предыдущего этапа
    let prevStage: { id: string; type: StageType } | null = null;
    let taskEnd = -1;
    // Конец задачи, целиком прожитой до горизонта: сетка её уже не покрывает,
    // но дата релиза в таблице не должна пропадать — считаем от пинов напрямую.
    let pastEndDate: string | null = null;

    for (const stage of task.stages) {
      // Закреплённый этап, целиком оставшийся за началом горизонта, —
      // прошлое: выкидываем из расчёта, а не переразмещаем, иначе он
      // «воскрес» бы и снова занял человека. prevEnd не трогаем — следующий
      // этап задачи может начинаться с начала сетки.
      if (
        stage.pinnedStartDate &&
        !pinned.has(stage.id) &&
        stage.pinnedStartDate < data.horizonStart &&
        (done || stage.assigneeId)
      ) {
        const end = addWorkingDays(stage.pinnedStartDate, stage.durationDays - 1);
        if (!pastEndDate || end > pastEndDate) pastEndDate = end;
        scheduledStages.push({
          stageId: stage.id,
          taskId: task.id,
          taskName: task.name,
          type: stage.type,
          assigneeId: stage.assigneeId,
          priority: task.priority,
          startIndex: -1,
          endIndex: -1,
          pinned: true,
          done,
        });
        reasons.set(stage.id, {
          startDate: stage.pinnedStartDate,
          factors: [{ kind: 'manualPin', date: stage.pinnedStartDate }],
          conflicts: [],
        });
        continue;
      }

      const earliest = Math.max(prevEnd + 1, startFloor);
      const pin = pinned.get(stage.id);
      let startIndex: number;
      let isPinned = false;
      let isClipped = false;
      const factors: PlacementFactor[] = [];

      // Базовая граница: раньше неё этап не пытался встать в принципе.
      // Если предыдущий этап и earliestStart совпали по дате — показываем обе
      // причины, это честнее, чем выбирать «главную».
      if (!pin) {
        if (prevStage && prevEnd >= 0 && prevEnd + 1 === earliest) {
          factors.push({
            kind: 'prevStage',
            stageId: prevStage.id,
            stageType: prevStage.type,
            endDate: dayAt(prevEnd),
          });
        }
        if (task.earliestStart && startFloor > 0 && startFloor === earliest) {
          factors.push({ kind: 'earliestStart', date: task.earliestStart });
        }
      }

      if (pin) {
        // Закреплён вручную — стоит ровно там (уже зарезервирован в проходе 1).
        startIndex = pin.start;
        isPinned = true;
        isClipped = pin.clipped;
        factors.push({
          kind: 'manualPin',
          date: stage.pinnedStartDate ?? dayAt(pin.start),
        });
        // Пин не двигаем, но нарушение последовательности честно показываем:
        // drag&drop такое не даёт создать, однако сюда можно попасть иначе —
        // например, увеличив длительность предыдущего этапа в форме задачи.
        if (!done && startIndex <= prevEnd) {
          warnings.push(
            `Этап «${stage.type}» задачи «${task.name}» закреплён раньше окончания предыдущего этапа — порядок этапов нарушен.`,
          );
        }
      } else if (stage.assigneeId) {
        const busy = ensureBusy(stage.assigneeId);
        const unavailable =
          unavailableByEmployee.get(stage.assigneeId) ?? new Set<number>();
        const blocked: number[] = [];
        startIndex = findSlot(
          busy,
          unavailable,
          earliest,
          stage.durationDays,
          maxIndex,
          blocked,
        );
        factors.push(...blockersToFactors(blocked, unavailable, stage.assigneeId));
        // Дни между границей и стартом бывают свободны, но короче этапа —
        // без этого объяснение выглядит неполным («вроде же было пусто»).
        const gapEnd = startIndex === -1 ? maxIndex : startIndex;
        if (blocked.length > 0 && gapEnd > earliest) {
          let best = 0;
          let run = 0;
          for (let d = Math.max(0, earliest); d < gapEnd; d++) {
            if (busy.has(d) || unavailable.has(d)) run = 0;
            else if (++run > best) best = run;
          }
          if (best > 0) {
            factors.push({
              kind: 'shortGap',
              freeDays: best,
              neededDays: stage.durationDays,
            });
          }
        }
        if (startIndex === -1) {
          factors.push({ kind: 'noSlot' });
          if (!done) {
            warnings.push(
              `Не удалось разместить этап «${stage.type}» задачи «${task.name}» в пределах расчётного горизонта.`,
            );
          }
        } else {
          for (let d = startIndex; d < startIndex + stage.durationDays; d++) {
            busy.add(d);
            markOccupied(stage.assigneeId, d, stage.id);
          }
        }
      } else {
        // Без исполнителя ресурсного ограничения нет — кладём сразу после предыдущего.
        startIndex = earliest;
        factors.push({ kind: 'noAssignee' });
        // По завершённым задачам не ворчим — они уже сделаны.
        if (!done) {
          warnings.push(
            `Этап «${stage.type}» задачи «${task.name}» без исполнителя — учтён по времени, но не занимает ничью загрузку.`,
          );
        }
      }

      // У обрезанного этапа конец задан пином (прожитая часть не входит),
      // у остальных — старт плюс длительность.
      const endIndex = pin
        ? pin.end
        : startIndex === -1
          ? -1
          : startIndex + stage.durationDays - 1;

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
        done,
        clippedStart: isClipped || undefined,
      });

      reasons.set(stage.id, {
        // У обрезанного пина настоящий старт — в прошлом, а не на краю сетки.
        startDate: isClipped
          ? (stage.pinnedStartDate ?? dayAt(startIndex))
          : startIndex === -1
            ? null
            : dayAt(startIndex),
        factors,
        conflicts: [],
      });

      if (endIndex >= 0) {
        prevEnd = endIndex;
        prevStage = { id: stage.id, type: stage.type };
        taskEnd = Math.max(taskEnd, endIndex);
      }
    }

    // Если вся задача прожита до горизонта, конец берём из pastEndDate —
    // дата релиза остаётся в таблице, хотя на ганте задачи уже нет.
    const qaEndDate = taskEnd >= 0 ? days[taskEnd] : pastEndDate;
    releases.push({
      taskId: task.id,
      taskName: task.name,
      qaEndIndex: taskEnd,
      qaEndDate,
      releaseDate: qaEndDate ? nextReleaseDay(qaEndDate) : null,
      done,
    });
  }

  // Наложения: кто с кем пересёкся и на каких датах (A.3). Считаем после
  // размещения — до конца прохода 2 картина занятости ещё неполная.
  for (const [, byDay] of occupancy) {
    const pairs = new Map<string, number[]>();
    for (const [idx, list] of byDay) {
      if (list.length < 2) continue;
      for (const a of list) {
        for (const b of list) {
          if (a === b) continue;
          const key = a + '|' + b;
          const indices = pairs.get(key) ?? [];
          indices.push(idx);
          pairs.set(key, indices);
        }
      }
    }
    for (const [key, indices] of pairs) {
      const [a, b] = key.split('|');
      const meta = stageMeta.get(b);
      const placement = reasons.get(a);
      if (!meta || !placement) continue;
      for (const run of toRuns(indices)) {
        placement.conflicts.push({
          stageId: b,
          taskId: meta.taskId,
          taskName: meta.taskName,
          stageType: meta.stageType,
          pinned: meta.pinned,
          from: dayAt(run.from),
          to: dayAt(run.to),
        });
      }
    }
  }
  for (const placement of reasons.values()) {
    placement.conflicts.sort((a, b) => a.from.localeCompare(b.from));
  }

  return { days, scheduledStages, releases, occupancy, reasons, warnings };
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
