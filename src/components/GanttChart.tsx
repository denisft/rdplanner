import { useMemo, useState } from 'react';
import type { AppData, Employee, Specialization, StageType } from '../types';
import { SPECIALIZATION_LABELS, SPECIALIZATION_ORDER, STAGE_LABELS } from '../types';
import type { ScheduleResult, ScheduledStage } from '../engine/scheduler';
import { overloadedDays } from '../engine/scheduler';
import { parseISO, formatISO, shortLabel, SHORT_MONTHS } from '../engine/dates';
import { stageAllows } from '../roles';
import { STAGE_STYLE } from './stageStyle';

const CELL = 34; // ширина колонки дня, px
const NAME_W = 200; // ширина колонки с именем
const LANE_H = 24; // высота одной дорожки, px

interface Props {
  data: AppData;
  result: ScheduleResult;
  /** Показывать ли маркеры релизов (🚀) поверх сетки. */
  showReleases: boolean;
  /** Перетащить этап на сотрудника и день (закрепляет вручную). */
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  /** Снять ручное закрепление (вернуть в авторежим). */
  onUnpinStage: (stageId: string) => void;
}

/** Этап, разложенный на дорожку, с обрезкой по видимому горизонту. */
interface LaidStage {
  stage: ScheduledStage;
  lane: number;
  visStart: number;
  visEnd: number;
}

interface RowLayout {
  stages: LaidStage[];
  laneCount: number;
  /** Непрерывные диапазоны перегруженных дней (индексы видимой сетки). */
  conflicts: { from: number; to: number }[];
  /** Видимых дней, занятых хотя бы одним этапом. */
  busyDays: number;
  /** Видимых дней с наложением (>1 этап). */
  overloadDays: number;
  /** stageId -> подписи задач, с которыми этап наложился. */
  conflictNames: Map<string, string[]>;
}

const DRAG_KEY = 'text/plain';

export function GanttChart({
  data,
  result,
  showReleases,
  onMoveStage,
  onUnpinStage,
}: Props) {
  const [draggingType, setDraggingType] = useState<StageType | null>(null);
  // Выбранная задача: подсвечиваем все её этапы (архитектура/разработка/ревью/QA),
  // остальные блоки притеняем. Клик по тому же этапу или по фону — снять выбор.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const visibleDays = data.horizonWeeks * 5;
  const days = result.days.slice(0, visibleDays);

  const stageById = useMemo(
    () => new Map(result.scheduledStages.map((s) => [s.stageId, s])),
    [result],
  );

  const grouped = useMemo(() => {
    const g = new Map<Specialization, Employee[]>();
    for (const spec of SPECIALIZATION_ORDER) g.set(spec, []);
    for (const emp of data.employees) g.get(emp.specialization)?.push(emp);
    return g;
  }, [data.employees]);

  // Группировка шапки по неделям.
  const weeks: { label: string; span: number }[] = [];
  for (let i = 0; i < days.length; i += 5) {
    const monday = parseISO(days[i]);
    weeks.push({
      label: `${monday.getDate()} ${SHORT_MONTHS[monday.getMonth()]}`,
      span: Math.min(5, days.length - i),
    });
  }

  const totalWidth = NAME_W + days.length * CELL;

  // Сегодняшний день в сетке. Если сегодня — выходной или вне горизонта, ставим
  // границу перед первым рабочим днём, который идёт после сегодняшней даты.
  const todayISO = formatISO(new Date());
  let todayIndex = days.indexOf(todayISO);
  const todayExact = todayIndex >= 0;
  if (!todayExact) todayIndex = days.findIndex((d) => d >= todayISO);

  // Дни релизов по задачам -> индекс в видимой сетке (в один день могут попасть
  // несколько задач — показываем один флажок со счётчиком). Релизы за правым
  // краем горизонта собираем отдельно и помечаем флажком «позже» у края.
  const lastVisibleISO = days[days.length - 1] ?? null;
  const releaseMarkers = new Map<number, string[]>();
  const beyondReleases: { name: string; date: string }[] = [];
  for (const r of result.releases) {
    if (!r.releaseDate) continue;
    const idx = days.indexOf(r.releaseDate);
    if (idx === -1) {
      if (lastVisibleISO && r.releaseDate > lastVisibleISO) {
        beyondReleases.push({ name: r.taskName, date: r.releaseDate });
      }
      continue;
    }
    const list = releaseMarkers.get(idx) ?? [];
    list.push(r.taskName);
    releaseMarkers.set(idx, list);
  }
  beyondReleases.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div style={{ width: totalWidth }} className="relative text-xs">
        {/* Шапка: недели */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div
            style={{ width: NAME_W }}
            className="shrink-0 px-3 py-1 font-medium text-slate-500"
          >
            Сотрудник
          </div>
          {weeks.map((w, i) => (
            <div
              key={i}
              style={{ width: w.span * CELL }}
              className="shrink-0 border-l border-slate-200 px-2 py-1 font-medium text-slate-600"
            >
              нед. {i + 1} · {w.label}
            </div>
          ))}
        </div>

        {/* Шапка: дни */}
        <div className="flex border-b border-slate-200 bg-white">
          <div style={{ width: NAME_W }} className="shrink-0" />
          {days.map((iso, i) => {
            const d = parseISO(iso);
            const weekStart = i % 5 === 0;
            const isToday = iso === todayISO;
            return (
              <div
                key={iso}
                style={{ width: CELL }}
                className={`shrink-0 py-1 text-center text-[10px] ${
                  isToday ? 'font-bold text-rose-600' : 'text-slate-400'
                } ${weekStart ? 'border-l border-slate-200' : ''}`}
              >
                {d.getDate()}
              </div>
            );
          })}
        </div>

        {/* Тело: группы по специализации */}
        {SPECIALIZATION_ORDER.map((spec) => {
          const emps = grouped.get(spec) ?? [];
          if (emps.length === 0) return null;
          return (
            <div key={spec}>
              <div className="bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                {SPECIALIZATION_LABELS[spec]}
              </div>
              {emps.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  days={days}
                  layout={layoutRow(emp.id, days.length, result, stageById)}
                  draggingType={draggingType}
                  setDraggingType={setDraggingType}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  onMoveStage={onMoveStage}
                  onUnpinStage={onUnpinStage}
                />
              ))}
            </div>
          );
        })}

        {/* Слой маркеров поверх всей сетки. Не перехватывает мышь, чтобы
            drag&drop этапов продолжал работать (бейджи — точечные исключения). */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {/* Сегодня: подсветка колонки (или граница, если сегодня выходной). */}
          {todayIndex >= 0 &&
            (todayExact ? (
              <div
                className="absolute bottom-0 top-0 border-x border-rose-400 bg-rose-500/10"
                style={{ left: NAME_W + todayIndex * CELL, width: CELL }}
              >
                <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b bg-rose-500 px-1 text-[9px] font-medium text-white">
                  сегодня
                </span>
              </div>
            ) : (
              <div
                className="absolute bottom-0 top-0 border-l-2 border-dashed border-rose-400"
                style={{ left: NAME_W + todayIndex * CELL }}
              >
                <span className="absolute left-0 top-0 rounded-br bg-rose-500 px-1 text-[9px] font-medium text-white">
                  сегодня
                </span>
              </div>
            ))}

          {/* Релизы: пунктир по центру дня релиза + флажок 🚀. Если в один день
              релизятся несколько задач — рядом счётчик, все имена в подсказке. */}
          {showReleases &&
            [...releaseMarkers.entries()].map(([idx, names]) => (
              <div
                key={idx}
                className="absolute bottom-0 top-0 border-l-2 border-dashed border-emerald-500"
                style={{ left: NAME_W + idx * CELL + CELL / 2 }}
              >
                <span
                  className="pointer-events-auto absolute left-0 top-0 flex -translate-x-1/2 cursor-help items-center gap-0.5"
                  title={`Релиз ${names.length > 1 ? '(' + names.length + ')' : ''}: ${names.join(', ')}`}
                >
                  <span className="text-[11px]">🚀</span>
                  {names.length > 1 && (
                    <span className="rounded-full bg-emerald-600 px-1 text-[8px] font-bold leading-tight text-white">
                      {names.length}
                    </span>
                  )}
                </span>
              </div>
            ))}

          {/* Релизы за правым краем горизонта: один флажок «позже» у края,
              в подсказке — список задач с датами. Увеличьте «Горизонт», чтобы
              увидеть их на сетке. */}
          {showReleases && beyondReleases.length > 0 && (
            <div
              className="absolute bottom-0 top-0 border-l-2 border-dotted border-emerald-400"
              style={{ left: totalWidth - 2 }}
            >
              <span
                className="pointer-events-auto absolute right-0 top-0 flex cursor-help items-center gap-0.5 whitespace-nowrap rounded-bl bg-emerald-600 px-1 py-0.5 text-[9px] font-medium text-white"
                title={
                  'Релизы за горизонтом (увеличьте «Горизонт», чтобы показать):\n' +
                  beyondReleases
                    .map((r) => `${r.name} — ${shortLabel(r.date)}`)
                    .join('\n')
                }
              >
                🚀 позже ({beyondReleases.length})
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Раскладывает этапы сотрудника по дорожкам (жадная interval-раскраска):
 * пересекающиеся по времени этапы попадают на разные дорожки и видны оба.
 * Дни с наложением собираются в непрерывные диапазоны для красной подсветки.
 */
function layoutRow(
  empId: string,
  visibleCount: number,
  result: ScheduleResult,
  stageById: Map<string, ScheduledStage>,
): RowLayout {
  const stages = result.scheduledStages
    .filter(
      (s) =>
        s.assigneeId === empId && s.startIndex >= 0 && s.startIndex < visibleCount,
    )
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

  // laneEnds[i] — индекс последнего занятого дня дорожки i.
  const laneEnds: number[] = [];
  const laid: LaidStage[] = [];
  for (const s of stages) {
    let lane = laneEnds.findIndex((end) => end < s.startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endIndex);
    } else {
      laneEnds[lane] = s.endIndex;
    }
    laid.push({
      stage: s,
      lane,
      visStart: s.startIndex,
      visEnd: Math.min(s.endIndex, visibleCount - 1),
    });
  }

  // Перегруженные дни -> непрерывные диапазоны.
  const overloaded = [...overloadedDays(result.occupancy, empId)]
    .filter((i) => i < visibleCount)
    .sort((a, b) => a - b);
  const conflicts: { from: number; to: number }[] = [];
  for (const idx of overloaded) {
    const last = conflicts[conflicts.length - 1];
    if (last && idx === last.to + 1) last.to = idx;
    else conflicts.push({ from: idx, to: idx });
  }

  // Кто с кем наложился — для подсказок на блоках.
  const conflictNames = new Map<string, Set<string>>();
  const occ = result.occupancy.get(empId);
  if (occ) {
    for (const [idx, list] of occ) {
      if (idx >= visibleCount || list.length < 2) continue;
      for (const id of list) {
        let set = conflictNames.get(id);
        if (!set) {
          set = new Set();
          conflictNames.set(id, set);
        }
        for (const other of list) {
          if (other === id) continue;
          const os = stageById.get(other);
          if (os) set.add(`${os.taskName} · ${STAGE_LABELS[os.type]}`);
        }
      }
    }
  }

  let busyDays = 0;
  if (occ) {
    for (const idx of occ.keys()) if (idx < visibleCount) busyDays++;
  }

  return {
    stages: laid,
    laneCount: Math.max(1, laneEnds.length),
    conflicts,
    busyDays,
    overloadDays: overloaded.length,
    conflictNames: new Map(
      [...conflictNames.entries()].map(([id, set]) => [id, [...set]]),
    ),
  };
}

function EmployeeRow({
  emp,
  days,
  layout,
  draggingType,
  setDraggingType,
  selectedTaskId,
  setSelectedTaskId,
  onMoveStage,
  onUnpinStage,
}: {
  emp: Employee;
  days: string[];
  layout: RowLayout;
  draggingType: StageType | null;
  setDraggingType: (t: StageType | null) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  onUnpinStage: (stageId: string) => void;
}) {
  const rowH = layout.laneCount * LANE_H;
  const droppable =
    draggingType !== null && stageAllows(draggingType, emp);

  const dropOnDay = (e: React.DragEvent, dayIndex: number) => {
    const stageId = e.dataTransfer.getData(DRAG_KEY);
    if (stageId && droppable) {
      onMoveStage(stageId, emp.id, days[Math.min(dayIndex, days.length - 1)]);
    }
    setDraggingType(null);
  };

  return (
    <div
      className={`flex border-b border-slate-100 ${
        droppable ? 'bg-sky-50' : 'hover:bg-slate-50/60'
      }`}
    >
      <div
        style={{ width: NAME_W, height: rowH }}
        className="flex shrink-0 items-center justify-between gap-2 px-3"
      >
        <span className="truncate text-slate-700" title={emp.name}>
          {emp.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
          {layout.overloadDays > 0 && (
            <span
              className="rounded bg-red-100 px-1 py-px font-semibold text-red-700"
              title="Дней, когда на человеке больше одной задачи"
            >
              ⚠ {layout.overloadDays} дн
            </span>
          )}
          <span className="tabular-nums text-slate-400">
            {layout.busyDays}/{days.length}д
          </span>
        </span>
      </div>

      <div
        className="relative"
        style={{ width: days.length * CELL, height: rowH }}
        onClick={() => setSelectedTaskId(null)}
      >
        {/* Фон: ячейки дней — сетка недель и цели для сброса. */}
        <div className="absolute inset-0 flex">
          {days.map((_, i) => (
            <div
              key={i}
              style={{ width: CELL }}
              className={`h-full shrink-0 ${
                i % 5 === 0 ? 'border-l border-slate-200' : ''
              }`}
              onDragOver={(e) => {
                if (droppable) e.preventDefault();
              }}
              onDrop={(e) => dropOnDay(e, i)}
            />
          ))}
        </div>

        {/* Блоки этапов: каждый — отдельный элемент на своей дорожке. */}
        {layout.stages.map(({ stage: s, lane, visStart, visEnd }) => {
          const conflictsWith = layout.conflictNames.get(s.stageId);
          // Состояние блока относительно выбранной задачи: подсвечен / притенён.
          const selected = selectedTaskId === s.taskId;
          const dimmed = selectedTaskId !== null && !selected;
          return (
            <div
              key={s.stageId}
              draggable
              onClick={(e) => {
                e.stopPropagation(); // не дать фону сбросить выбор
                setSelectedTaskId(selected ? null : s.taskId);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_KEY, s.stageId);
                e.dataTransfer.effectAllowed = 'move';
                setDraggingType(s.type);
              }}
              onDragEnd={() => setDraggingType(null)}
              onDoubleClick={() => s.pinned && onUnpinStage(s.stageId)}
              onDragOver={(e) => {
                if (droppable) e.preventDefault();
              }}
              onDrop={(e) => {
                // Сброс поверх чужого блока: день вычисляем по позиции курсора.
                const rect = e.currentTarget.getBoundingClientRect();
                dropOnDay(e, visStart + Math.floor((e.clientX - rect.left) / CELL));
              }}
              style={{
                left: visStart * CELL,
                width: (visEnd - visStart + 1) * CELL,
                top: lane * LANE_H + 2,
                height: LANE_H - 4,
              }}
              className={`absolute flex cursor-grab items-center rounded-sm transition-opacity ${
                STAGE_STYLE[s.type]
              } ${s.pinned ? 'border border-white/80' : ''} ${
                selected ? 'z-10 ring-2 ring-slate-900 ring-offset-1' : ''
              } ${dimmed ? 'opacity-25' : ''}`}
              title={`${s.taskName} · ${STAGE_LABELS[s.type]}${
                conflictsWith
                  ? '\nНАЛОЖЕНИЕ с: ' + conflictsWith.join('; ')
                  : ''
              }${s.pinned ? '\nзакреплён (двойной клик — открепить)' : ''}`}
            >
              <span className="truncate px-1 text-[10px] font-medium leading-none">
                {s.taskName}
              </span>
            </div>
          );
        })}

        {/* Зоны наложения: красная подложка + рамка на всю высоту строки.
            pointer-events-none — блоки под ними остаются перетаскиваемыми. */}
        {layout.conflicts.map((c) => (
          <div
            key={c.from}
            className="pointer-events-none absolute inset-y-0 z-10 rounded-sm bg-red-500/15 ring-2 ring-inset ring-red-500"
            style={{ left: c.from * CELL, width: (c.to - c.from + 1) * CELL }}
          />
        ))}
      </div>
    </div>
  );
}
