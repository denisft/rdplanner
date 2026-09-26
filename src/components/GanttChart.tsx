import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { AlertTriangle, Check, Crosshair, Flag, Pin, Users } from 'lucide-react';
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
  isoWeek,
  shortLabel,
  rangeToIndices,
  SHORT_WEEKDAYS,
} from '../engine/dates';
import { stageAllows } from '../roles';
import {
  DONE_STAGE_STYLE,
  STAGE_DOT,
  STAGE_STYLE,
  UNAVAILABLE_STRIPES,
} from './stageStyle';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';

const NAME_W = 200; // ширина колонки с именем
const NAME_W_NARROW = 140; // она же на узком экране
const MIN_CELL = 20; // колонка дня не уже этого — дальше горизонтальный скролл
const LANE_H = 26; // высота одной дорожки, px
const BLOCK_H = 22; // высота блока этапа
const ROW_MIN_H = 38; // строка не ниже этого: имя + полоска загрузки

/** Управление гантом снаружи (горячая клавиша T). */
export interface GanttHandle {
  scrollToToday: () => void;
}

interface Props {
  data: AppData;
  result: ScheduleResult;
  /** Показывать ли маркеры релизов поверх сетки. */
  showReleases: boolean;
  /** Занять всю высоту родителя со своим вертикальным скроллом
      (полноэкранный режим); иначе — обычная карточка со скроллом по X. */
  fillHeight?: boolean;
  /** Просмотр по ссылке: без перетаскивания и открытия задач. */
  readOnly?: boolean;
  /** Перетащить этап на сотрудника и день (закрепляет вручную). */
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  /** Снять ручное закрепление (вернуть в авторежим). */
  onUnpinStage: (stageId: string) => void;
  /** Открыть задачу (клик по блоку). */
  onOpenTask: (taskId: string) => void;
  /** Подсвеченная задача (наведение на строку таблицы или блок). */
  highlightTaskId: string | null;
  /** Наведение на блок: связь ганта с таблицей задач. */
  onHoverTask: (taskId: string | null) => void;
  /** Пустая команда: кнопка «Добавить сотрудников». */
  onManagePeople?: () => void;
  /** Левая часть шапки карточки (заголовок, горизонт). */
  headStart?: ReactNode;
  /** Правая часть шапки карточки (переключатели, кнопки). */
  headEnd?: ReactNode;
  ref?: Ref<GanttHandle>;
}

/** Этап, разложенный на дорожку, с обрезкой по видимому горизонту. */
interface LaidStage {
  stage: ScheduledStage;
  lane: number;
  visStart: number;
  visEnd: number;
  /** Свободных колонок справа до следующего блока на той же дорожке. */
  gapAfter: number;
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
  /** Этапов за правым краем видимого горизонта. */
  hiddenAfter: number;
}

const DRAG_KEY = 'text/plain';

/** Задержка перед карточкой «почему этап здесь», мс: беглое движение мышью
    по ганту не должно вызывать мельтешение поповеров. */
const EXPLAIN_DELAY = 350;

/** Пауза перед открытием задачи по клику: даёт распознать двойной клик
    (он снимает закрепление, а не открывает задачу). */
const CLICK_DELAY = 230;

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

/** Куда ляжет этап при броске: строка, день и можно ли туда. */
interface DropHint {
  employeeId: string;
  day: number;
  ok: boolean;
}

// Ширина подписи блока: меряем реальным шрифтом, чтобы решить, влезает ли
// название внутрь блока или его лучше вынести справа.
let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();
function textWidth(text: string): number {
  const cached = widthCache.get(text);
  if (cached !== undefined) return cached;
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = "700 11.5px 'Manrope Variable', sans-serif";
  }
  const w = measureCtx ? measureCtx.measureText(text).width : text.length * 6.6;
  widthCache.set(text, w);
  return w;
}

export function GanttChart({
  data,
  result,
  showReleases,
  fillHeight = false,
  readOnly = false,
  onMoveStage,
  onUnpinStage,
  onOpenTask,
  highlightTaskId,
  onHoverTask,
  onManagePeople,
  headStart,
  headEnd,
  ref,
}: Props) {
  const [dragging, setDragging] = useState<DragInfo | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  // Скролл-контейнер — для автопрокрутки к «сегодня» и замера ширины.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  // Объяснение размещения (БЛ-1): карточка по наведению на блок, с задержкой.
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
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
  useEffect(
    () => () => {
      cancelHoverTimer();
      if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    },
    [],
  );

  // Ширина контейнера: колонки дней растягиваются на всю карточку.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleDays = data.horizonWeeks * 5;
  const days = result.days.slice(0, visibleDays);
  const nameW = boxWidth > 0 && boxWidth < 640 ? NAME_W_NARROW : NAME_W;
  const cell =
    boxWidth > 0
      ? Math.max(MIN_CELL, Math.floor((boxWidth - nameW - 1) / Math.max(1, days.length)))
      : 34;

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

  const totalWidth = nameW + days.length * cell;

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
      scrollRef.current.scrollTo({
        left: Math.max(0, (todayIndex - 1) * cell),
        behavior: 'smooth',
      });
    }
  };
  useImperativeHandle(ref, () => ({ scrollToToday }));

  // При открытии сразу показываем сегодняшний день (живой план «уезжает»
  // вправо от начала горизонта, докручивать руками каждый раз — боль).
  // Ждём первого замера ширины: до него ширина колонки ещё не известна.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || boxWidth === 0) return;
    didInitialScroll.current = true;
    if (todayIndex > 0 && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIndex - 1) * cell);
    }
  }, [boxWidth, todayIndex, cell]);

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

  // Раскладка строк не зависит от наведения — считаем один раз на расчёт.
  const layouts = useMemo(() => {
    const m = new Map<string, RowLayout>();
    for (const emp of data.employees) m.set(emp.id, layoutRow(emp.id, days.length, result));
    return m;
  }, [data.employees, days.length, result]);

  // Дни релизов по задачам -> индекс в видимой сетке (в один день могут попасть
  // несколько задач — показываем один флажок со счётчиком). Релизы за правым
  // краем горизонта собираем отдельно и помечаем флажком «позже» у края.
  const lastVisibleISO = days[days.length - 1] ?? null;
  const releaseMarkers = new Map<number, string[]>();
  const beyondReleases: { name: string; date: string }[] = [];
  for (const r of result.releases) {
    // Релизы завершённых задач не показываем — их флажки только шумели бы.
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

  // Шапка по неделям: номер недели по ISO и диапазон дат.
  const weeks: { label: string; range: string; span: number }[] = [];
  for (let i = 0; i < days.length; i += 5) {
    const span = Math.min(5, days.length - i);
    weeks.push({
      label: `Нед. ${isoWeek(days[i])}`,
      range: rangeLabel(days[i], days[i + span - 1]),
      span,
    });
  }

  const openTaskSoon = (taskId: string) => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => onOpenTask(taskId), CLICK_DELAY);
  };
  const cancelOpenTask = () => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  };

  const endDrag = () => {
    setDragging(null);
    setDropHint(null);
  };

  const hasPeople = data.employees.length > 0;

  return (
    <section
      className={`min-w-0 rounded-[14px] border border-line bg-surface shadow-card ${
        fillHeight ? 'flex h-full flex-col' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3.5 py-2.5">
        {headStart}
        <Legend />
        <div className="flex-1" />
        {hasPeople && todayIndex > 0 && (
          <Tip label="Прокрутить к сегодняшнему дню" shortcut="T">
            <Button size="sm" onClick={scrollToToday}>
              <Crosshair size={14} />
              Сегодня
            </Button>
          </Tip>
        )}
        {headEnd}
      </div>

      <div
        ref={scrollRef}
        // Карточка объяснения приколота к окну, а не к сетке: при прокрутке и
        // уходе мыши с ганта её проще убрать, чем пересчитывать позицию.
        onScroll={closeExplain}
        onMouseLeave={() => {
          closeExplain();
          onHoverTask(null);
        }}
        className={`rounded-b-[14px] ${fillHeight ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto'}`}
      >
        {!hasPeople ? (
          <EmptyTeam onManagePeople={readOnly ? undefined : onManagePeople} />
        ) : (
          <div style={{ width: totalWidth }} className="relative text-xs">
            {/* Шапка. В полноэкранном режиме прилипает к верху скролла. */}
            <div className={fillHeight ? 'sticky top-0 z-40' : ''}>
              {/* Недели. Левая ячейка прилипает к краю при горизонтальной
                  прокрутке: z-30 — выше маркеров, чтобы линии «сегодня» и
                  релизов прятались под колонку, а не рисовались поверх имён. */}
              <div className="flex border-b border-line-soft bg-surface">
                <div
                  style={{ width: nameW }}
                  className="sticky left-0 z-30 flex h-[30px] shrink-0 items-center border-r border-line bg-surface px-3 text-[11.5px] font-bold tracking-[0.06em] text-faint uppercase"
                >
                  Сотрудник
                </div>
                {weeks.map((w, i) => (
                  <div
                    key={i}
                    style={{ width: w.span * cell }}
                    className="flex h-[30px] shrink-0 items-center gap-1.5 overflow-hidden border-l border-grid-week px-2 font-bold whitespace-nowrap text-muted"
                  >
                    <span className="text-ink">{w.label}</span>
                    {w.span * cell >= 120 && <span>{w.range}</span>}
                  </div>
                ))}
              </div>

              {/* Дни */}
              <div className="flex border-b border-line bg-surface">
                <div
                  style={{ width: nameW }}
                  className="sticky left-0 z-30 h-[26px] shrink-0 border-r border-line bg-surface"
                />
                {days.map((iso, i) => {
                  const d = parseISO(iso);
                  const isToday = iso === todayISO;
                  const showNum = cell >= 22 || i % 5 === 0 || isToday;
                  return (
                    <div
                      key={iso}
                      style={{ width: cell }}
                      title={`${SHORT_WEEKDAYS[d.getDay()]}, ${shortLabel(iso)}`}
                      className={`grid h-[26px] shrink-0 place-items-center border-l text-[11px] font-semibold tabular-nums ${
                        i % 5 === 0 ? 'border-grid-week' : 'border-grid'
                      } ${isToday ? 'font-extrabold text-today' : 'text-faint'}`}
                    >
                      {showNum ? d.getDate() : ''}
                    </div>
                  );
                })}
              </div>

              {/* Релизы: флажок со счётчиком в день релиза, имена — в подсказке. */}
              {showReleases && (
                <div className="flex border-b border-line bg-surface">
                  <div
                    style={{ width: nameW }}
                    className="sticky left-0 z-30 flex h-6 shrink-0 items-center border-r border-line bg-surface px-3 text-xs font-semibold text-faint"
                  >
                    Релизы
                  </div>
                  <div className="relative h-6" style={{ width: days.length * cell }}>
                    {[...releaseMarkers.entries()].map(([idx, names]) => (
                      <Tip
                        key={idx}
                        label={
                          <ReleaseList
                            title={`Релиз ${SHORT_WEEKDAYS[parseISO(days[idx]).getDay()]}, ${shortLabel(days[idx])}`}
                            lines={names}
                          />
                        }
                      >
                        <span
                          tabIndex={0}
                          style={{ left: idx * cell + cell / 2 }}
                          className="absolute top-[3px] inline-flex h-[18px] -translate-x-1/2 cursor-default items-center gap-[3px] rounded-full bg-release-light pr-1.5 pl-[5px] text-[11px] font-extrabold text-release"
                        >
                          <Flag size={11} strokeWidth={2.4} />
                          {names.length}
                        </span>
                      </Tip>
                    ))}
                    {beyondReleases.length > 0 && (
                      <Tip
                        label={
                          <ReleaseList
                            title="Релизы за горизонтом — увеличьте горизонт, чтобы увидеть их на сетке"
                            lines={beyondReleases.map((r) => `${r.name} — ${shortLabel(r.date)}`)}
                          />
                        }
                      >
                        <span
                          tabIndex={0}
                          className="absolute top-[3px] right-1.5 inline-flex h-[18px] cursor-default items-center gap-1 rounded-full border border-line bg-surface-2 px-2 text-[11px] font-bold whitespace-nowrap text-muted"
                        >
                          <Flag size={11} />
                          позже · {beyondReleases.length}
                        </span>
                      </Tip>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Тело */}
            <div className="relative">
              {/* Подложка под блоками: прошлое и пунктиры релизов. */}
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: nameW, width: days.length * cell }}
              >
                {todayIndex > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 bg-past"
                    style={{ width: todayIndex * cell }}
                  />
                )}
                {showReleases &&
                  [...releaseMarkers.keys()].map((idx) => (
                    <div
                      key={idx}
                      className="absolute inset-y-0 border-l-[1.5px] border-dashed border-release opacity-35"
                      style={{ left: idx * cell + cell / 2 }}
                    />
                  ))}
              </div>

              {SPECIALIZATION_ORDER.map((spec) => {
                const emps = grouped.get(spec) ?? [];
                if (emps.length === 0) return null;
                return (
                  <div key={spec}>
                    <div className="relative flex border-b border-line-soft bg-surface-2">
                      <div
                        style={{ width: nameW }}
                        className="sticky left-0 z-30 flex h-7 shrink-0 items-center gap-2 border-r border-line bg-surface-2 px-3 text-[11px] font-extrabold tracking-[0.07em] text-faint uppercase"
                      >
                        {SPECIALIZATION_LABELS[spec]} · {emps.length}
                      </div>
                    </div>
                    {emps.map((emp) => (
                      <EmployeeRow
                        key={emp.id}
                        emp={emp}
                        days={days}
                        cell={cell}
                        nameW={nameW}
                        readOnly={readOnly}
                        layout={layouts.get(emp.id)!}
                        durationById={durationById}
                        orderBoundsById={orderBoundsById}
                        dragging={dragging}
                        setDragging={setDragging}
                        dropHint={dropHint?.employeeId === emp.id ? dropHint : null}
                        setDropHint={setDropHint}
                        endDrag={endDrag}
                        highlightTaskId={highlightTaskId}
                        onHoverTask={onHoverTask}
                        onClickTask={openTaskSoon}
                        onDoubleClickStage={(s) => {
                          cancelOpenTask();
                          if (!readOnly && s.pinned && !s.done) onUnpinStage(s.stageId);
                        }}
                        onMoveStage={onMoveStage}
                        onExplain={openExplain}
                        onExplainEnd={closeExplain}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Сегодня: тонкая линия поверх блоков, но под колонкой имён. */}
              {todayIndex >= 0 && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-today"
                  style={{ left: nameW + todayIndex * cell + (todayExact ? cell / 2 : 0) }}
                >
                  <span className="absolute top-0 left-1 rounded-r px-1 text-[9.5px] leading-[15px] font-extrabold whitespace-nowrap text-white bg-today">
                    сегодня
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Объяснение размещения наведённого этапа. */}
      {hovered && stageById.has(hovered.stageId) && (
        <StageExplainCard
          stage={stageById.get(hovered.stageId)!}
          placement={result.reasons.get(hovered.stageId)}
          employeeName={data.employees.find((e) => e.id === hovered.employeeId)?.name}
          durationDays={durationById.get(hovered.stageId) ?? 0}
          realStart={pinnedStartById.get(hovered.stageId)}
          days={result.days}
          anchor={hovered.anchor}
          readOnly={readOnly}
        />
      )}
    </section>
  );
}

function Legend() {
  const item = (dot: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      {label}
    </span>
  );
  const sw = (cls: string, style?: React.CSSProperties) => (
    <i className={`inline-block h-2.5 w-2.5 rounded-[3px] ${cls}`} style={style} />
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] font-medium text-muted">
      {(['architecture', 'development', 'review', 'qa'] as StageType[]).map((t) => (
        <span key={t}>{item(sw(STAGE_DOT[t]), STAGE_LABELS[t])}</span>
      ))}
      {item(sw('ring-2 ring-inset ring-danger'), 'Наложение')}
      {item(sw('ring-1 ring-inset ring-line', { backgroundImage: UNAVAILABLE_STRIPES }), 'Отпуск')}
      {item(sw('bg-stage-done'), 'Завершена')}
    </div>
  );
}

function ReleaseList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="grid gap-1 py-0.5">
      <div className="font-bold">{title}</div>
      <ul className="grid gap-0.5 pl-4 [list-style:disc]">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyTeam({ onManagePeople }: { onManagePeople?: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 px-4 py-14 text-center text-muted">
      <Users size={22} />
      <b className="text-base text-ink">В команде пока никого нет</b>
      <span>Добавьте сотрудников — здесь появится их загрузка по дням.</span>
      {onManagePeople && (
        <Button variant="primary" onClick={onManagePeople}>
          Добавить сотрудников
        </Button>
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
  readOnly,
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
  readOnly: boolean;
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

  const chip = (text: string) => (
    <span className="rounded-md bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-muted">
      {text}
    </span>
  );

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + 6,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="pointer-events-none fixed z-[90] grid w-[300px] gap-2 rounded-xl border border-line bg-surface p-3 text-[12.5px] leading-snug text-ink shadow-pop"
    >
      <div className="flex items-center gap-2 text-xs font-bold text-muted">
        <i
          className={`inline-block h-2.5 w-2.5 rounded-[3px] ${stage.done ? 'bg-stage-done' : STAGE_DOT[stage.type]}`}
        />
        {STAGE_LABELS[stage.type]} · {employeeName ?? 'без исполнителя'}
      </div>
      <div className="text-sm leading-tight font-extrabold">{stage.taskName}</div>
      <div className="flex justify-between gap-2.5 text-muted">
        <span>Даты</span>
        <b className="font-bold text-ink tabular-nums">
          {start && end ? rangeLabel(start, end) : '—'}
          {durationDays > 0 ? ` · ${durationDays} дн.` : ''}
        </b>
      </div>
      {(stage.done || stage.pinned || stage.clippedStart) && (
        <div className="flex flex-wrap gap-1">
          {stage.done && chip('✓ завершена')}
          {stage.pinned && !stage.done && chip('закреплён вручную')}
          {stage.clippedStart && chip('начат до горизонта')}
        </div>
      )}

      <div className="grid gap-1 border-t border-line-soft pt-2">
        <div className="text-[11px] font-bold tracking-[0.06em] text-faint uppercase">
          Почему здесь
        </div>
        <div className="font-semibold">{explanation.headline}</div>
        {explanation.lines.length > 0 && (
          <ul className="grid gap-0.5 pl-4 [list-style:disc]">
            {explanation.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {explanation.conflicts.length > 0 && (
        <div className="grid gap-1 border-t border-line-soft pt-2 text-error-ink">
          <div className="text-[11px] font-bold tracking-[0.06em] uppercase">Наложение</div>
          <div>{employeeName ?? 'Исполнитель'} в эти дни ведёт ещё:</div>
          <ul className="grid gap-0.5 pl-4 [list-style:disc]">
            {explanation.conflicts.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && (
        <div className="text-[11.5px] text-faint">
          {stage.done
            ? 'Клик — открыть задачу'
            : stage.pinned
              ? 'Клик — открыть задачу · перетащить — сдвинуть · двойной клик — открепить'
              : 'Клик — открыть задачу · перетащить — закрепить на дате'}
        </div>
      )}
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
  const own = result.scheduledStages.filter((s) => s.assigneeId === empId);
  const stages = own
    .filter((s) => s.startIndex >= 0 && s.startIndex < visibleCount)
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  const hiddenAfter = own.filter((s) => s.startIndex >= visibleCount).length;

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
      gapAfter: 0,
    });
  }
  // Свободное место справа от блока на его дорожке — туда выносится подпись,
  // если название не влезает в сам блок.
  for (const l of laid) {
    const next = laid
      .filter((o) => o.lane === l.lane && o.visStart > l.visEnd)
      .reduce((m, o) => Math.min(m, o.visStart), visibleCount);
    l.gapAfter = next - l.visEnd - 1;
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
    hiddenAfter,
  };
}

/**
 * Недоступность сотрудника в координатах видимой сетки: непрерывные диапазоны
 * для штриховки + подпись по каждому дню (даты исходного диапазона).
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
  cell,
  nameW,
  readOnly,
  layout,
  durationById,
  orderBoundsById,
  dragging,
  setDragging,
  dropHint,
  setDropHint,
  endDrag,
  highlightTaskId,
  onHoverTask,
  onClickTask,
  onDoubleClickStage,
  onMoveStage,
  onExplain,
  onExplainEnd,
}: {
  emp: Employee;
  days: string[];
  cell: number;
  nameW: number;
  readOnly: boolean;
  layout: RowLayout;
  /** stageId -> полная длительность этапа в рабочих днях. */
  durationById: Map<string, number>;
  /** stageId -> границы закрепления по порядку этапов задачи. */
  orderBoundsById: Map<string, PinOrderBounds>;
  dragging: DragInfo | null;
  setDragging: (d: DragInfo | null) => void;
  dropHint: DropHint | null;
  setDropHint: (h: DropHint | null) => void;
  endDrag: () => void;
  highlightTaskId: string | null;
  onHoverTask: (taskId: string | null) => void;
  onClickTask: (taskId: string) => void;
  onDoubleClickStage: (s: ScheduledStage) => void;
  onMoveStage: (stageId: string, employeeId: string, isoDate: string) => void;
  /** Показать карточку «почему этап здесь» (с задержкой). */
  onExplain: (stageId: string, employeeId: string, el: HTMLElement) => void;
  /** Убрать карточку. */
  onExplainEnd: () => void;
}) {
  const rowH = Math.max(ROW_MIN_H, layout.laneCount * LANE_H + 8);
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

  // День под курсором: считаем по координате внутри дорожки — так бросок
  // работает и поверх чужих блоков.
  const dayAt = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - rect.left) / cell)));
  };

  const load = days.length > 0 ? Math.min(100, (layout.busyDays / days.length) * 100) : 0;
  const hasHighlight = highlightTaskId !== null;

  return (
    <div className="flex border-b border-line-soft">
      {/* Ячейка имени прилипает к левому краю; фон непрозрачный,
          z-30 — поверх сетки и маркеров. */}
      <div
        style={{ width: nameW, height: rowH }}
        className={`sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1 border-r border-line px-3 ${
          droppable ? 'bg-primary-light' : 'bg-surface'
        }`}
      >
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-bold" title={emp.name}>
            {emp.name}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-faint tabular-nums">
            {layout.overloadDays > 0 && (
              <Tip label={`Наложение: ${layout.overloadDays} дн. — на человеке больше одной задачи`}>
                <span className="inline-flex items-center gap-0.5 text-error-ink">
                  <AlertTriangle size={11} />
                  {layout.overloadDays}
                </span>
              </Tip>
            )}
            {layout.busyDays}/{days.length} дн
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-line-soft">
          <i
            className={`block h-full rounded-full ${
              layout.overloadDays > 0 ? 'bg-danger' : load > 85 ? 'bg-warning' : 'bg-primary'
            }`}
            style={{ width: `${load}%` }}
          />
        </div>
      </div>

      <div
        className={`relative shrink-0 ${droppable ? 'bg-primary-light/60' : ''}`}
        style={{
          width: days.length * cell,
          height: rowH,
          backgroundImage:
            'linear-gradient(to right, var(--color-grid-week) 1px, transparent 1px), linear-gradient(to right, var(--color-grid) 1px, transparent 1px)',
          backgroundSize: `${cell * 5}px 100%, ${cell}px 100%`,
        }}
        onDragOver={(e) => {
          if (!droppable) return;
          const day = dayAt(e);
          const ok = canDropAt(day);
          if (ok) e.preventDefault();
          if (!dropHint || dropHint.day !== day || dropHint.ok !== ok) {
            setDropHint({ employeeId: emp.id, day, ok });
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null);
        }}
        onDrop={(e) => {
          const stageId = e.dataTransfer.getData(DRAG_KEY);
          const day = dayAt(e);
          if (stageId && canDropAt(day)) onMoveStage(stageId, emp.id, days[day]);
          endDrag();
        }}
      >
        {/* Недоступность (отпуск/больничный): штриховка под блоками этапов. */}
        {unavailable.spans.map((u) => (
          <div
            key={u.from}
            title={unavailable.titles.get(u.from)}
            className="absolute inset-y-0 flex items-end justify-center pb-px"
            style={{
              left: u.from * cell,
              width: (u.to - u.from + 1) * cell,
              backgroundImage: UNAVAILABLE_STRIPES,
            }}
          >
            {(u.to - u.from + 1) * cell >= 56 && (
              <span className="rounded-[3px] bg-surface px-1 text-[9.5px] font-bold tracking-[0.06em] text-muted uppercase">
                отпуск
              </span>
            )}
          </div>
        ))}

        {/* Зоны наложения: красная подложка на всю высоту строки. */}
        {layout.conflicts.map((c) => (
          <div
            key={c.from}
            className="pointer-events-none absolute inset-y-0 rounded-sm bg-danger/10 ring-2 ring-danger ring-inset"
            style={{ left: c.from * cell, width: (c.to - c.from + 1) * cell }}
          />
        ))}

        {/* Куда ляжет этап при броске. */}
        {dropHint && dragging && (
          <div
            className={`pointer-events-none absolute z-10 rounded-md border-2 border-dashed ${
              dropHint.ok ? 'border-primary bg-primary/10' : 'border-danger bg-danger/10'
            }`}
            style={{
              left: dropHint.day * cell + 1,
              width: Math.min(dragging.durationDays, days.length - dropHint.day) * cell - 2,
              top: 3,
              bottom: 3,
            }}
          />
        )}

        {/* Блоки этапов: каждый — отдельный элемент на своей дорожке. */}
        {layout.stages.map(({ stage: s, lane, visStart, visEnd, gapAfter }) => {
          const highlighted = highlightTaskId === s.taskId;
          const dimmed = hasHighlight && !highlighted;
          const width = (visEnd - visStart + 1) * cell - 3;
          const iconW = s.done || s.pinned ? 14 : 0;
          const fits = textWidth(s.taskName) + 14 + iconW <= width;
          const outsideW = gapAfter * cell - 8;
          const top = lane * LANE_H + (rowH - layout.laneCount * LANE_H) / 2 + (LANE_H - BLOCK_H) / 2;
          return (
            <div key={s.stageId}>
              <div
                draggable={!s.done && !readOnly}
                tabIndex={readOnly ? -1 : 0}
                role={readOnly ? undefined : 'button'}
                aria-label={`${STAGE_LABELS[s.type]}: ${s.taskName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!readOnly) onClickTask(s.taskId);
                }}
                onKeyDown={(e) => {
                  if (!readOnly && e.key === 'Enter') onClickTask(s.taskId);
                }}
                onMouseEnter={(e) => {
                  onHoverTask(s.taskId);
                  onExplain(s.stageId, emp.id, e.currentTarget);
                }}
                onMouseLeave={() => {
                  onHoverTask(null);
                  onExplainEnd();
                }}
                onDragStart={(e) => {
                  if (s.done || readOnly) return;
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
                onDragEnd={endDrag}
                onDoubleClick={() => onDoubleClickStage(s)}
                style={{ left: visStart * cell + 1.5, width, top, height: BLOCK_H }}
                className={`absolute z-[1] flex items-center gap-[3px] overflow-hidden px-[7px] text-[11.5px] leading-none font-bold whitespace-nowrap shadow-[inset_0_-1px_0_rgb(0_0_0/0.1)] transition-[opacity,box-shadow] select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                  s.done
                    ? `${DONE_STAGE_STYLE} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`
                    : `${STAGE_STYLE[s.type]} ${readOnly ? 'cursor-default' : 'cursor-grab'}`
                } ${
                  s.clippedStart
                    ? 'rounded-r-md border-l-2 border-dashed border-l-white/90'
                    : 'rounded-md'
                } ${visEnd < s.endIndex ? 'rounded-r-none' : ''} ${
                  highlighted ? 'z-[2] ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
                } ${dimmed ? 'opacity-25' : ''}`}
              >
                {s.done ? (
                  <Check size={11} strokeWidth={2.6} className="shrink-0" />
                ) : s.pinned ? (
                  <Pin size={11} strokeWidth={2.4} className="shrink-0" />
                ) : null}
                {fits && <span className="truncate">{s.taskName}</span>}
              </div>
              {/* Название не влезло в блок — выносим справа, если есть место. */}
              {!fits && outsideW >= 48 && (
                <span
                  className={`pointer-events-none absolute z-[1] truncate text-[11.5px] leading-[22px] font-semibold text-muted transition-opacity ${
                    dimmed ? 'opacity-25' : ''
                  }`}
                  style={{ left: (visEnd + 1) * cell + 4, top, maxWidth: outsideW }}
                >
                  {s.taskName}
                </span>
              )}
            </div>
          );
        })}

        {layout.hiddenAfter > 0 && (
          <Tip label={`Этапов за видимым горизонтом: ${layout.hiddenAfter}`}>
            <span className="absolute top-1/2 right-1 z-[2] inline-flex h-[18px] -translate-y-1/2 items-center rounded-full border border-line bg-surface px-1.5 text-[10.5px] font-extrabold text-muted">
              +{layout.hiddenAfter} →
            </span>
          </Tip>
        )}
      </div>
    </div>
  );
}
