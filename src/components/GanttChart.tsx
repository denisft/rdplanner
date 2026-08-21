import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Employee, Specialization, StageType } from '../types';
import { SPECIALIZATION_LABELS, SPECIALIZATION_ORDER, STAGE_LABELS } from '../types';
import type {
  ScheduleResult,
  ScheduledStage,
  StagePlacement,
} from '../engine/scheduler';
import { overloadedDays } from '../engine/scheduler';
import { explainPlacement, rangeLabel } from '../engine/explain';
import type { PinOrderBounds } from '../engine/pinOrder';
import { pinOrderBounds } from '../engine/pinOrder';
import {
  parseISO,
  formatISO,
  shortLabel,
  rangeToIndices,
  SHORT_MONTHS,
} from '../engine/dates';
import { stageAllows } from '../roles';
import { DONE_STAGE_STYLE, STAGE_STYLE, UNAVAILABLE_STRIPES } from './stageStyle';

const CELL = 34; // ширина колонки дня, px
const NAME_W = 200; // ширина колонки с именем
const LANE_H = 24; // высота одной дорожки, px

interface Props {
  data: AppData;
  result: ScheduleResult;
  /** Показывать ли маркеры релизов (🚀) поверх сетки. */
  showReleases: boolean;
  /** Занять всю высоту родителя со своим вертикальным скроллом
      (полноэкранный режим); иначе — обычная карточка со скроллом по X. */
  fillHeight?: boolean;
  /** Перетащить этап на сотрудника и день (закрепляет вручную). */
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  /** Снять ручное закрепление (вернуть в авторежим). */
  onUnpinStage: (stageId: string) => void;
  /** Открыть задачу на редактирование (Alt+двойной клик по блоку). */
  onEditTask: (taskId: string) => void;
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
}

const DRAG_KEY = 'text/plain';

/** Задержка перед карточкой «почему этап здесь», мс: беглое движение мышью
    по ганту не должно вызывать мельтешение поповеров. */
const EXPLAIN_DELAY = 350;

/** Наведённый блок: что объясняем и где стоял блок в момент наведения. */
interface HoverInfo {
  stageId: string;
  employeeId: string;
  anchor: DOMRect;
}

/** Что тащим: тип этапа (для проверки ролей), текущий исполнитель — его
    строка принимает этап всегда, даже если по ролям он этап вести «не может»
    (иначе этап, назначенный вопреки ролям, было бы не сдвинуть по датам),
    длительность (не подсвечивать дни, где блок лёг бы на отпуск) и границы
    по порядку этапов задачи (ревью не раньше конца разработки). */
interface DragInfo {
  type: StageType;
  assigneeId: string | null;
  durationDays: number;
  bounds: PinOrderBounds;
}

export function GanttChart({
  data,
  result,
  showReleases,
  fillHeight = false,
  onMoveStage,
  onUnpinStage,
  onEditTask,
}: Props) {
  const [dragging, setDragging] = useState<DragInfo | null>(null);
  // Выбранная задача: подсвечиваем все её этапы (архитектура/разработка/ревью/QA),
  // остальные блоки притеняем. Клик по тому же этапу или по фону — снять выбор.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Скролл-контейнер — для автопрокрутки к «сегодня» и кнопки «сегодня».
  const scrollRef = useRef<HTMLDivElement>(null);
  // Объяснение размещения (БЛ-1): карточка по наведению на блок, с задержкой.
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const cancelHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const openExplain = (stageId: string, employeeId: string, el: HTMLElement) => {
    cancelHoverTimer();
    // Позицию блока фиксируем сразу: карточка позиционируется относительно
    // окна (position: fixed), иначе её обрезал бы скролл ганта.
    const anchor = el.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(
      () => setHovered({ stageId, employeeId, anchor }),
      EXPLAIN_DELAY,
    );
  };
  const closeExplain = () => {
    cancelHoverTimer();
    setHovered(null);
  };
  useEffect(() => cancelHoverTimer, []);

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

  // Прокрутка к «сегодня»: колонка сразу после закреплённой колонки имён,
  // с одним рабочим днём контекста слева. Имена — sticky, их скролл не трогает.
  const scrollToToday = () => {
    if (todayIndex > 0 && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIndex - 1) * CELL);
    }
  };
  // При открытии сразу показываем сегодняшний день (живой план «уезжает»
  // вправо от начала горизонта, докручивать руками каждый раз — боль).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scrollToToday, []);

  // Реальные даты старта закреплённых этапов — для подсказки на блоках,
  // обрезанных началом горизонта (их видимый старт — не настоящий).
  const pinnedStartById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of data.tasks)
      for (const st of t.stages)
        if (st.pinnedStartDate) m.set(st.id, st.pinnedStartDate);
    return m;
  }, [data.tasks]);

  // Полные длительности этапов — у обрезанных блоков видимая ширина меньше
  // реальной, а при перетаскивании этап закрепляется целиком.
  const durationById = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.tasks)
      for (const st of t.stages) m.set(st.id, st.durationDays);
    return m;
  }, [data.tasks]);

  // Границы закрепления по порядку этапов задачи — чтобы при перетаскивании
  // не подсвечивать дни, где этап встал бы раньше конца предыдущего.
  const orderBoundsById = useMemo(() => {
    const m = new Map<string, PinOrderBounds>();
    for (const t of data.tasks)
      for (const st of t.stages) m.set(st.id, pinOrderBounds(t, st.id, result));
    return m;
  }, [data.tasks, result]);

  // Дни релизов по задачам -> индекс в видимой сетке (в один день могут попасть
  // несколько задач — показываем один флажок со счётчиком). Релизы за правым
  // краем горизонта собираем отдельно и помечаем флажком «позже» у края.
  const lastVisibleISO = days[days.length - 1] ?? null;
  const releaseMarkers = new Map<number, string[]>();
  const beyondReleases: { name: string; date: string }[] = [];
  for (const r of result.releases) {
    // Релизы завершённых задач не показываем — их ракеты только шумели бы.
    if (r.done || !r.releaseDate) continue;
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
    <div
      ref={scrollRef}
      // Карточка объяснения приколота к окну, а не к сетке: при прокрутке и
      // уходе мыши с ганта её проще убрать, чем пересчитывать позицию.
      onScroll={closeExplain}
      onMouseLeave={closeExplain}
      className={`rounded-xl bg-white shadow-card ${
        fillHeight ? 'h-full overflow-auto' : 'overflow-x-auto'
      }`}
    >
      <div style={{ width: totalWidth }} className="relative text-xs">
        {/* Шапка: недели. Левая ячейка прилипает к краю при горизонтальной
            прокрутке: z-30 — выше слоя маркеров (z-20), чтобы линии «сегодня»
            и релизов прятались под колонку, а не рисовались поверх имён. */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div
            style={{ width: NAME_W }}
            className="sticky left-0 z-30 flex shrink-0 items-center justify-between bg-slate-50 px-3 py-1 font-medium text-slate-500"
          >
            Сотрудник
            {todayIndex > 0 && (
              <button
                onClick={scrollToToday}
                title="Прокрутить гант к сегодняшнему дню"
                className="rounded-full border border-slate-300 px-2 text-[11px] font-normal text-slate-500 hover:bg-slate-100"
              >
                сегодня
              </button>
            )}
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
          <div
            style={{ width: NAME_W }}
            className="sticky left-0 z-30 shrink-0 bg-white"
          />
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
              <div className="flex bg-slate-100">
                <div
                  style={{ width: NAME_W }}
                  className="sticky left-0 z-30 shrink-0 bg-slate-100 px-3 py-1 font-semibold text-slate-700"
                >
                  {SPECIALIZATION_LABELS[spec]}
                </div>
              </div>
              {emps.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  days={days}
                  layout={layoutRow(emp.id, days.length, result)}
                  durationById={durationById}
                  orderBoundsById={orderBoundsById}
                  dragging={dragging}
                  setDragging={setDragging}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  onMoveStage={onMoveStage}
                  onUnpinStage={onUnpinStage}
                  onEditTask={onEditTask}
                  onExplain={openExplain}
                  onExplainEnd={closeExplain}
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

      {/* Объяснение размещения наведённого этапа. */}
      {hovered && stageById.has(hovered.stageId) && (
        <StageExplainCard
          stage={stageById.get(hovered.stageId)!}
          placement={result.reasons.get(hovered.stageId)}
          employeeName={
            data.employees.find((e) => e.id === hovered.employeeId)?.name
          }
          durationDays={durationById.get(hovered.stageId) ?? 0}
          realStart={pinnedStartById.get(hovered.stageId)}
          days={result.days}
          anchor={hovered.anchor}
        />
      )}
    </div>
  );
}

/**
 * Карточка «почему этап здесь»: факты о блоке плюс объяснение из движка.
 * Приколота к окну (position: fixed) — так её не режет скролл ганта; мышь
 * не перехватывает, чтобы не мешать перетаскиванию.
 */
function StageExplainCard({
  stage,
  placement,
  employeeName,
  durationDays,
  realStart,
  days,
  anchor,
}: {
  stage: ScheduledStage;
  placement: StagePlacement | undefined;
  employeeName?: string;
  durationDays: number;
  /** Дата ручного закрепления — настоящий старт обрезанного блока. */
  realStart?: string;
  /** Полная расчётная сетка дней (не только видимая). */
  days: string[];
  anchor: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Первый кадр рисуем невидимым, чтобы измерить карточку и решить,
  // показывать её под блоком или над ним (у нижних строк места нет).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let left = Math.max(margin, anchor.left);
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - height - 6);
    }
    setPos({ left, top });
  }, [anchor]);

  const explanation = explainPlacement(placement, employeeName);
  // У обрезанного блока видимый старт — край сетки, а не настоящая дата.
  const start =
    stage.clippedStart && realStart
      ? realStart
      : stage.startIndex >= 0
        ? days[stage.startIndex]
        : null;
  const end =
    stage.endIndex >= 0 ? days[Math.min(stage.endIndex, days.length - 1)] : null;

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + 6,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="pointer-events-none fixed z-50 w-72 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-snug text-slate-600 shadow-lg"
    >
      <div className="font-semibold text-slate-800">
        {stage.taskName} · {STAGE_LABELS[stage.type]}
      </div>
      <div className="mt-0.5 text-slate-500">
        {employeeName ?? 'без исполнителя'}
        {start && end ? ` · ${rangeLabel(start, end)}` : ''}
        {durationDays > 0 ? ` · ${durationDays} дн` : ''}
      </div>
      {(stage.done || stage.pinned || stage.clippedStart) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {stage.done && (
            <span className="rounded bg-slate-100 px-1 py-px text-slate-500">
              ✓ завершена
            </span>
          )}
          {stage.pinned && !stage.done && (
            <span className="rounded bg-slate-100 px-1 py-px text-slate-500">
              закреплён вручную
            </span>
          )}
          {stage.clippedStart && (
            <span className="rounded bg-slate-100 px-1 py-px text-slate-500">
              начат до горизонта
            </span>
          )}
        </div>
      )}

      <div className="mt-2 border-t border-slate-100 pt-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          Почему здесь
        </div>
        <div className="mt-0.5 text-slate-700">{explanation.headline}</div>
        {explanation.lines.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {explanation.lines.map((line, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-slate-300">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {explanation.conflicts.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-1.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-500">
            Наложение
          </div>
          <div className="mt-0.5 text-rose-700">
            {employeeName ?? 'Исполнитель'} в эти дни ведёт ещё:
          </div>
          <ul className="mt-1 space-y-0.5 text-rose-700">
            {explanation.conflicts.map((line, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-rose-300">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
        {stage.done
          ? 'Alt+двойной клик — редактировать задачу'
          : stage.pinned
            ? 'Перетащить — сдвинуть · двойной клик — открепить · Alt+двойной клик — редактировать'
            : 'Перетащить — закрепить на дате · Alt+двойной клик — редактировать'}
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

  // Кто с кем наложился — считает движок (result.reasons), карточка объяснения
  // берёт это оттуда вместе с датами пересечения.
  const occ = result.occupancy.get(empId);

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
  };
}

/**
 * Недоступность сотрудника в координатах видимой сетки: непрерывные диапазоны
 * для серой подложки + подсказка по каждому дню (даты исходного диапазона).
 */
function unavailableLayout(emp: Employee, days: string[]) {
  const dayToIndex = new Map(days.map((d, i) => [d, i]));
  const titles = new Map<number, string>();
  for (const r of emp.unavailable) {
    const label =
      r.from === r.to
        ? `Недоступен: ${shortLabel(r.from)}`
        : `Недоступен: ${shortLabel(r.from)} – ${shortLabel(r.to)}`;
    for (const idx of rangeToIndices(r.from, r.to, dayToIndex)) {
      titles.set(idx, label);
    }
  }
  // Дни -> непрерывные видимые диапазоны (пересекающиеся отпуска сливаются).
  const spans: { from: number; to: number }[] = [];
  for (const idx of [...titles.keys()].sort((a, b) => a - b)) {
    const last = spans[spans.length - 1];
    if (last && idx === last.to + 1) last.to = idx;
    else spans.push({ from: idx, to: idx });
  }
  return { spans, titles };
}

function EmployeeRow({
  emp,
  days,
  layout,
  durationById,
  orderBoundsById,
  dragging,
  setDragging,
  selectedTaskId,
  setSelectedTaskId,
  onMoveStage,
  onUnpinStage,
  onEditTask,
  onExplain,
  onExplainEnd,
}: {
  emp: Employee;
  days: string[];
  layout: RowLayout;
  /** stageId -> полная длительность этапа в рабочих днях. */
  durationById: Map<string, number>;
  /** stageId -> границы закрепления по порядку этапов задачи. */
  orderBoundsById: Map<string, PinOrderBounds>;
  dragging: DragInfo | null;
  setDragging: (d: DragInfo | null) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  onUnpinStage: (stageId: string) => void;
  onEditTask: (taskId: string) => void;
  /** Показать карточку «почему этап здесь» (с задержкой). */
  onExplain: (stageId: string, employeeId: string, el: HTMLElement) => void;
  /** Убрать карточку. */
  onExplainEnd: () => void;
}) {
  const rowH = layout.laneCount * LANE_H;
  const unavailable = unavailableLayout(emp, days);
  // Куда можно бросить: по ролям — или на текущего исполнителя (двигаем по
  // датам, не меняя человека), чтобы этап не оказался «неперетаскиваемым».
  const droppable =
    dragging !== null &&
    (stageAllows(dragging.type, emp) || dragging.assigneeId === emp.id);

  // Можно ли бросить на день `i`: блок этапа (i .. i+длительность-1) не должен
  // задевать отпуск/больничный и ломать порядок этапов задачи (не раньше конца
  // предыдущего; наезд на следующий закреплённый не блокируем — см. pinOrder).
  // Дни за видимой сеткой перепроверяет moveStage по реальным датам.
  const canDropAt = (i: number) => {
    if (!droppable || dragging === null) return false;
    for (let d = i; d < i + dragging.durationDays; d++) {
      if (unavailable.titles.has(d)) return false;
    }
    const { minStart } = dragging.bounds;
    if (minStart && days[i] < minStart) return false;
    return true;
  };

  const dropOnDay = (e: React.DragEvent, dayIndex: number) => {
    const stageId = e.dataTransfer.getData(DRAG_KEY);
    const day = Math.min(dayIndex, days.length - 1);
    if (stageId && canDropAt(day)) {
      onMoveStage(stageId, emp.id, days[day]);
    }
    setDragging(null);
  };

  return (
    <div
      className={`group flex border-b border-slate-100 ${
        droppable ? 'bg-primary-light' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Ячейка имени прилипает к левому краю; фон непрозрачный (при ховере и
          drag&drop повторяет подсветку строки), z-30 — поверх сетки и маркеров. */}
      <div
        style={{ width: NAME_W, height: rowH }}
        className={`sticky left-0 z-30 flex shrink-0 items-center justify-between gap-2 px-3 ${
          droppable ? 'bg-primary-light' : 'bg-white group-hover:bg-slate-50'
        }`}
      >
        <span className="truncate text-slate-700" title={emp.name}>
          {emp.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
          {layout.overloadDays > 0 && (
            <span
              className="rounded-full bg-error-light px-1.5 py-px font-semibold text-rose-700"
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
              title={unavailable.titles.get(i)}
              onDragOver={(e) => {
                if (canDropAt(i)) e.preventDefault();
              }}
              onDrop={(e) => dropOnDay(e, i)}
            />
          ))}
        </div>

        {/* Недоступность (отпуск/больничный): серая штриховка под блоками этапов.
            pointer-events-none — drag&drop и подсказки работают через ячейки фона. */}
        {unavailable.spans.map((u) => (
          <div
            key={u.from}
            className="pointer-events-none absolute inset-y-0 bg-slate-200/50"
            style={{
              left: u.from * CELL,
              width: (u.to - u.from + 1) * CELL,
              backgroundImage: UNAVAILABLE_STRIPES,
            }}
          />
        ))}

        {/* Блоки этапов: каждый — отдельный элемент на своей дорожке. */}
        {layout.stages.map(({ stage: s, lane, visStart, visEnd }) => {
          // Состояние блока относительно выбранной задачи: подсвечен / притенён.
          const selected = selectedTaskId === s.taskId;
          const dimmed = selectedTaskId !== null && !selected;
          return (
            <div
              key={s.stageId}
              draggable={!s.done}
              onClick={(e) => {
                e.stopPropagation(); // не дать фону сбросить выбор
                setSelectedTaskId(selected ? null : s.taskId);
              }}
              onMouseEnter={(e) => onExplain(s.stageId, emp.id, e.currentTarget)}
              onMouseLeave={onExplainEnd}
              onDragStart={(e) => {
                if (s.done) return;
                onExplainEnd(); // карточка не должна висеть над перетаскиванием
                e.dataTransfer.setData(DRAG_KEY, s.stageId);
                e.dataTransfer.effectAllowed = 'move';
                setDragging({
                  type: s.type,
                  assigneeId: s.assigneeId,
                  durationDays: durationById.get(s.stageId) ?? 1,
                  bounds: orderBoundsById.get(s.stageId) ?? { minStart: null },
                });
              }}
              onDragEnd={() => setDragging(null)}
              onDoubleClick={(e) => {
                // Alt+двойной клик — редактирование задачи, обычный — открепить.
                // У завершённых открепление выключено, чтобы случайно не
                // «разбудить» историю; редактирование остаётся доступным.
                if (e.altKey) onEditTask(s.taskId);
                else if (s.pinned && !s.done) onUnpinStage(s.stageId);
              }}
              onDragOver={(e) => {
                // Поверх чужого блока: целевой день — по позиции курсора.
                const rect = e.currentTarget.getBoundingClientRect();
                const day =
                  visStart + Math.floor((e.clientX - rect.left) / CELL);
                if (canDropAt(Math.min(day, days.length - 1))) e.preventDefault();
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
              className={`absolute flex items-center transition-opacity ${
                s.done ? `cursor-default ${DONE_STAGE_STYLE}` : `cursor-grab ${STAGE_STYLE[s.type]}`
              } ${s.pinned && !s.done ? 'border border-white/80' : ''} ${
                s.clippedStart
                  ? 'rounded-r-sm border-l-2 border-l-white/90 [border-left-style:dashed]'
                  : 'rounded-sm'
              } ${
                selected ? 'z-10 ring-2 ring-slate-900 ring-offset-1' : ''
              } ${dimmed ? 'opacity-25' : ''}`}
              // Нативного title у блока нет: всё, что он показывал, вместе с
              // объяснением размещения ушло в карточку по наведению — иначе
              // системная подсказка всплывала бы поверх неё.
            >
              <span className="truncate px-1 text-[10px] font-medium leading-none">
                {s.done ? `✓ ${s.taskName}` : s.taskName}
              </span>
            </div>
          );
        })}

        {/* Зоны наложения: красная подложка + рамка на всю высоту строки.
            pointer-events-none — блоки под ними остаются перетаскиваемыми. */}
        {layout.conflicts.map((c) => (
          <div
            key={c.from}
            className="pointer-events-none absolute inset-y-0 z-10 rounded-sm bg-error/15 ring-2 ring-inset ring-error"
            style={{ left: c.from * CELL, width: (c.to - c.from + 1) * CELL }}
          />
        ))}
      </div>
    </div>
  );
}
