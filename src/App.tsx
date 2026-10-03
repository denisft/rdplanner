import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  BarChart3,
  ChartGantt,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  Keyboard,
  Link2,
  Link2Off,
  Maximize2,
  Minimize2,
  Moon,
  PencilLine,
  PinOff,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Sun,
  Trash2,
  Undo2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { Employee, Specialization, Task } from './types';
import { schedule, stageOverlapsUnavailable } from './engine/scheduler';
import { pinRespectsOrder } from './engine/pinOrder';
import { teamView } from './engine/teams';
import { completeTask, reopenTask } from './engine/complete';
import { pastViewStart, shiftHorizonStart, shiftTarget } from './engine/horizon';
import { gridDayCount } from './engine/gridRange';
import { formatISO, parseISO } from './engine/dates';
import { rangeLabel } from './engine/explain';
import { GanttChart, type GanttHandle } from './components/GanttChart';
import { TaskDrawer, type DrawerImpact, type DrawerMode } from './components/TaskDrawer';
import { releaseShifts } from './engine/urgentImpact';
import { EmployeeManager } from './components/EmployeeManager';
import { ReportModal } from './components/ReportModal';
import { ReleasesTable } from './components/ReleasesTable';
import { formatShort } from './components/format';
import { TeamTabs } from './components/TeamTabs';
import { WarningsButton } from './components/WarningsButton';
import { KeyboardHelp } from './components/KeyboardHelp';
import { makeSampleData } from './data/sampleData';
import {
  saveToFile,
  openFromFile,
  autosave,
  loadAutosave,
  hasFileSystemAccess,
  type FsFileHandle,
} from './storage/fileStorage';
import {
  publishPlan,
  fetchSharedPlan,
  shareUrl,
  planIdFromUrl,
  getShareId,
  clearShare,
  revokePlan,
  WrongEditKeyError,
} from './storage/shareStorage';
import { downloadMarkdown } from './export/markdownExport';
import { downloadReleasesCsv } from './export/csvExport';
import { track } from './analytics';
import { usePlanHistory } from './history';
import { useTheme } from './ui/theme';
import { useToast } from './ui/useToast';
import { useConfirm } from './ui/useConfirm';
import { Button, IconButton } from './ui/Button';
import { buttonClass } from './ui/buttonClass';
import { Tip } from './ui/Tooltip';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuNote,
  MenuSeparator,
  MenuTrigger,
} from './ui/Menu';

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Настройка вида «показывать релизы на ганте» — личное предпочтение зрителя,
// поэтому живёт в localStorage, а не в данных плана (файл/общая ссылка).
const SHOW_RELEASES_KEY = 'resource-planner:show-releases';

// Настройка вида «показывать прошлое на ганте» (этапы до начала плана) —
// тоже личное предпочтение зрителя; по умолчанию выключена.
const SHOW_PAST_KEY = 'resource-planner:show-past';

// Плашка «сдвиньте начало горизонта»: закрытие запоминается до конца дня.
// Тоже настройка вида — в localStorage, не в AppData.
const SHIFT_NUDGE_KEY = 'resource-planner:shift-nudge-dismissed';

// Активная команда — личная настройка вида (какую вкладку смотрит зритель),
// поэтому в localStorage, а не в AppData.
const ACTIVE_TEAM_KEY = 'resource-planner:active-team';

/** Варианты горизонта в переключателе; нестандартное значение из файла
    показывается дополнительным сегментом. */
const HORIZON_OPTIONS = [2, 4, 8, 12];

function loadShowReleases(): boolean {
  try {
    return localStorage.getItem(SHOW_RELEASES_KEY) !== '0';
  } catch {
    return true;
  }
}

function loadShowPast(): boolean {
  try {
    return localStorage.getItem(SHOW_PAST_KEY) === '1';
  } catch {
    return false;
  }
}

function loadActiveTeam(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TEAM_KEY);
  } catch {
    return null;
  }
}

/** Пишет ли пользователь в поле ввода — тогда горячие клавиши не трогаем. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/** Событие пришло из открытого окна или меню — однобуквенные клавиши не наши. */
function insideOverlay(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('[role="dialog"],[role="alertdialog"],[role="menu"]');
}

export default function App() {
  // Если открыли по общей ссылке (?plan=...) — режим только-чтения.
  const sharedId = useMemo(() => planIdFromUrl(), []);
  const readOnly = sharedId !== null;

  // План и история правок. Любая правка плана — через editData: снимок для
  // отмены и сам апдейт делаются вместе (см. history.ts).
  const history = usePlanHistory(() =>
    readOnly ? makeSampleData() : loadAutosave() ?? makeSampleData(),
  );
  const { data, undo, redo, canUndo, canRedo } = history;
  const editData = history.edit;

  const toast = useToast();
  const confirm = useConfirm();
  const theme = useTheme();
  const undoAction = { label: 'Отменить', onClick: undo };

  const [handle, setHandle] = useState<FsFileHandle | null>(null);
  // Боковая панель задачи: создание, правка или срочная (БЛ-17). Пока она
  // открыта, гант и таблица показывают план с черновиком — предпросмотр.
  const [drawer, setDrawer] = useState<{ mode: DrawerMode; task?: Task } | null>(null);
  const [draft, setDraft] = useState<Task | null>(null);
  const closeDrawer = () => {
    setDrawer(null);
    setDraft(null);
  };
  const [showTeam, setShowTeam] = useState(false);
  // Модалка «Отчёт за период» — доступна и в режиме просмотра по ссылке.
  const [showReport, setShowReport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [shareLink, setShareLink] = useState<string>('');
  // Публикация в процессе: «Поделиться» заблокирована, повторный клик невозможен.
  // Ref — синхронная страховка: два клика в одном тике не успевают увидеть
  // обновлённый стейт, а ref видят сразу.
  const [sharing, setSharing] = useState<boolean>(false);
  const sharingRef = useRef(false);
  const [loading, setLoading] = useState<boolean>(readOnly);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [showReleases, setShowReleases] = useState<boolean>(loadShowReleases);
  // Фокус-режим: гант разворачивается на всё окно (оверлей), Esc — выход.
  // Осознанное действие на сеанс, поэтому в localStorage не запоминаем.
  const [ganttFull, setGanttFull] = useState(false);
  // Связь ганта и таблицы: задача под курсором подсвечивается в обоих местах.
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const ganttRef = useRef<GanttHandle>(null);
  // Вкладка команды, которая сейчас переименовывается на месте.
  const [renamingTeamId, setRenamingTeamId] = useState<string | null>(null);

  const toggleReleases = () =>
    setShowReleases((v) => {
      const next = !v;
      try {
        localStorage.setItem(SHOW_RELEASES_KEY, next ? '1' : '0');
      } catch {
        // приватный режим — настройка просто не переживёт перезагрузку
      }
      return next;
    });

  const [showPast, setShowPast] = useState<boolean>(loadShowPast);
  const togglePast = () =>
    setShowPast((v) => {
      const next = !v;
      try {
        localStorage.setItem(SHOW_PAST_KEY, next ? '1' : '0');
      } catch {
        // приватный режим — настройка просто не переживёт перезагрузку
      }
      return next;
    });

  // Активная команда (вкладка). Валидируем против data.teams — при загрузке
  // чужого плана/демо запомненный id может не подойти, тогда берём первую команду.
  const [activeTeamId, setActiveTeamId] = useState<string | null>(loadActiveTeam);
  const effectiveTeamId =
    activeTeamId && data.teams.some((t) => t.id === activeTeamId)
      ? activeTeamId
      : data.teams[0]?.id ?? '';
  const setActiveTeam = (id: string) => {
    setActiveTeamId(id);
    setShareLink(''); // ссылка на предыдущую команду больше не актуальна
    setQuery('');
    try {
      localStorage.setItem(ACTIVE_TEAM_KEY, id);
    } catch {
      // приватный режим — просто не запомним выбор
    }
  };

  // Загрузка опубликованного плана при открытии по ссылке.
  const setPlan = history.set;
  useEffect(() => {
    if (!sharedId) return;
    fetchSharedPlan(sharedId)
      .then((d) => {
        setPlan(d);
        // Метрика распространения: сколько людей открывает планы по ссылкам.
        track('plan_opened_via_link');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    // setPlan — dispatch редьюсера, стабилен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedId]);

  // Срез по активной команде: на нём считаем гант, релизы, отчёт и экспорт.
  // Полный data остаётся источником истины (автосейв, editData).
  const viewData = useMemo(
    () => teamView(data, effectiveTeamId),
    [data, effectiveTeamId],
  );

  // Reflow: расписание активной команды пересчитывается при изменении её данных.
  const result = useMemo(() => schedule(viewData), [viewData]);

  // Предпросмотр боковой панели: план активной команды с черновиком задачи.
  // Рабочий data не меняется до «Сохранить». Новая задача, как и в addTask,
  // получает earliestStart = сегодня — чтобы предпросмотр совпал с итогом.
  const todayISO = formatISO(new Date());
  const previewView = useMemo(() => {
    if (!drawer || !draft) return viewData;
    const t: Task = { ...draft, teamId: effectiveTeamId };
    if (drawer.mode === 'edit') {
      return { ...viewData, tasks: viewData.tasks.map((x) => (x.id === t.id ? t : x)) };
    }
    return { ...viewData, tasks: [...viewData.tasks, { ...t, earliestStart: todayISO }] };
  }, [drawer, draft, viewData, effectiveTeamId, todayISO]);
  const shown = useMemo(
    () => (previewView === viewData ? result : schedule(previewView)),
    [previewView, viewData, result],
  );

  // Режим «Прошлое»: гант рисуется с самого раннего этапа, закреплённого до
  // начала плана. Это только вид — отдельный расчёт с растянутой влево сеткой;
  // таблица, отчёт и экспорт по-прежнему считаются от начала плана (`shown`).
  const pastStart = useMemo(() => pastViewStart(previewView), [previewView]);
  const ganttResult = useMemo(
    () =>
      showPast && pastStart ? schedule(previewView, { gridStart: pastStart }) : shown,
    [showPast, pastStart, previewView, shown],
  );

  // Что показать внизу панели: релиз черновика и чьи релизы он сдвинул.
  const drawerImpact = useMemo<DrawerImpact | null>(() => {
    if (!drawer || !draft) return null;
    const after = shown.releases.find((r) => r.taskId === draft.id);
    const before = result.releases.find((r) => r.taskId === draft.id);
    return {
      release: after?.releaseDate ?? null,
      releaseBefore: drawer.mode === 'edit' ? (before?.releaseDate ?? null) : null,
      unplaced: after ? after.qaEndIndex < 0 : false,
      rows: releaseShifts(result, shown, draft.id),
    };
  }, [drawer, draft, shown, result]);

  // Автосохранение в localStorage (только в своём режиме редактирования).
  useEffect(() => {
    if (!readOnly) autosave(data);
  }, [data, readOnly]);

  // Длина сетки ганта: выбранный горизонт, растянутый до последнего этапа.
  const visibleDays = gridDayCount(shown, data.horizonWeeks);

  // Счётчик в шапке — по активной команде; завершённые не смешиваем с работой.
  const activeTaskCount = viewData.tasks.filter((t) => !t.done).length;
  const doneTaskCount = viewData.tasks.length - activeTaskCount;
  const taskCountLabel =
    `${viewData.employees.length} чел · ${activeTaskCount} задач` +
    (doneTaskCount > 0 ? ` · ${doneTaskCount} завершено` : '');

  const releasesSorted = useMemo(
    () => [...shown.releases].sort((a, b) => a.qaEndIndex - b.qaEndIndex),
    [shown.releases],
  );

  // Таблица: активные — сверху, завершённые — в свёрнутую секцию
  // (свежезавершённые первыми).
  const activeReleases = useMemo(
    () => releasesSorted.filter((r) => !r.done),
    [releasesSorted],
  );
  const doneReleases = useMemo(() => {
    const completedAt = new Map(previewView.tasks.map((t) => [t.id, t.completedAt ?? '']));
    return releasesSorted
      .filter((r) => r.done)
      .sort((a, b) =>
        (completedAt.get(b.taskId) ?? '').localeCompare(
          completedAt.get(a.taskId) ?? '',
        ),
      );
  }, [releasesSorted, previewView.tasks]);

  // Последний видимый день горизонта — для пометки «за горизонтом».
  const lastVisibleDate = shown.days[visibleDays - 1] ?? null;

  const nextPriority = useMemo(() => {
    const min = viewData.tasks.reduce((m, t) => Math.min(m, t.priority), 3);
    return Math.max(1, min);
  }, [viewData.tasks]);

  const taskName = (id: string) => data.tasks.find((t) => t.id === id)?.name ?? '';

  // Новая задача попадает в активную команду. earliestStart = сегодня —
  // мягкая граница, чтобы задача вставала от текущего дня, а не от начала
  // горизонта (в прошлое). На старые задачи не влияет (у них поля нет).
  const addTask = (task: Task) => {
    editData((d) => ({
      ...d,
      tasks: [
        ...d.tasks,
        { ...task, teamId: effectiveTeamId, earliestStart: formatISO(new Date()) },
      ],
    }));
    toast(`Задача «${task.name}» добавлена в план`, { action: undoAction });
    // Счётчики масштаба — видно, демо это или живой план.
    track('task_created', {
      stages: task.stages.length,
      tasks_total: data.tasks.length + 1,
      employees_total: data.employees.length,
    });
  };

  const updateTask = (task: Task) => {
    editData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? task : t)),
    }));
    toast('Изменения сохранены', { action: undoAction });
  };

  const deleteTask = (id: string) => {
    const name = taskName(id);
    editData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
    toast(`Задача «${name}» удалена`, { action: undoAction });
  };

  // Отметить задачу завершённой: этапы замораживаются на текущих датах,
  // блоки на ганте сереют, строка уезжает в секцию «Завершённые».
  const markDone = (taskId: string) => {
    editData(completeTask(data, result, taskId, formatISO(new Date())));
    toast(`«${taskName(taskId)}» завершена — этапы зафиксированы на своих датах`, {
      action: undoAction,
    });
    track('task_completed');
  };

  // Вернуть завершённую в работу (закрепления этапов остаются на месте).
  const markActive = (taskId: string) => {
    editData(reopenTask(data, taskId));
    toast(`«${taskName(taskId)}» снова в работе`, { action: undoAction });
  };

  // Приоритет правится посимвольно в поле ввода — склеиваем правки одной
  // задачи в один шаг отмены.
  const setPriority = (id: string, priority: number) =>
    editData(
      (d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, priority } : t)),
      }),
      `priority:${id}`,
    );

  // Сколько недель показывать — настройка вида, а не правка плана:
  // намеренно мимо editData, чтобы не забивать стек отмены.
  const setHorizonWeeks = (w: number) => history.set((d) => ({ ...d, horizonWeeks: w }));

  // Сдвиг начала горизонта к текущей неделе (минус неделя контекста):
  // не перепланирование, а фиксация прошлого — даты релизов не меняются.
  const horizonTarget = shiftTarget(todayISO);
  const canShiftHorizon = data.horizonStart < horizonTarget;
  const shiftHorizon = () => {
    // Сдвиг горизонта — операция над всем планом (общая шкала), поэтому
    // фиксируем прошлое по расписанию всех команд, а не только активной.
    const fullResult = schedule(data);
    editData(shiftHorizonStart(data, fullResult, horizonTarget));
    toast(`Начало плана — ${formatShort(horizonTarget)}. Даты релизов не изменились`, {
      action: undoAction,
    });
  };

  // Плашка-напоминание: начало горизонта отстало больше чем на 2 недели.
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    try {
      return localStorage.getItem(SHIFT_NUDGE_KEY) === formatISO(new Date());
    } catch {
      return false;
    }
  });
  const horizonLagDays = Math.round(
    (parseISO(todayISO).getTime() - parseISO(data.horizonStart).getTime()) /
      86400000,
  );
  const showShiftNudge =
    !readOnly && canShiftHorizon && horizonLagDays > 14 && !nudgeDismissed;
  const dismissNudge = () => {
    setNudgeDismissed(true);
    try {
      localStorage.setItem(SHIFT_NUDGE_KEY, formatISO(new Date()));
    } catch {
      /* приватный режим — просто скроем до перезагрузки */
    }
  };

  const anyModal = drawer !== null || showTeam || showReport || showHelp;

  // Горячие клавиши. Однобуквенные — только когда фокус не в поле ввода и не
  // в открытом окне; Ctrl-сочетания — везде, кроме полей ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod) {
        if (readOnly || e.altKey) return;
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
        } else if (key === 's') {
          e.preventDefault();
          onSave();
        } else if (key === 'o') {
          e.preventDefault();
          onLoad();
        }
        return;
      }
      if (e.altKey || anyModal || insideOverlay(e.target)) return;
      // Проверяем физическую клавишу (e.code): N и T работают и в русской раскладке.
      if (e.code === 'KeyN' && !readOnly) {
        e.preventDefault();
        setDrawer({ mode: 'new' });
      } else if (e.code === 'KeyT') {
        ganttRef.current?.scrollToToday();
      } else if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
        e.preventDefault();
        setShowHelp(true);
      } else if (e.code === 'Slash' || e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && ganttFull) {
        setGanttFull(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Перетащили этап на сотрудника и день — закрепляем вручную.
  // Бросок, при котором блок этапа лёг бы на отпуск/больничный исполнителя
  // или сломал порядок этапов задачи (ревью раньше конца разработки),
  // молча отклоняется (гант такие цели и не подсвечивает — это второй рубеж).
  const moveStage = (stageId: string, employeeId: string, isoDate: string) => {
    const emp = data.employees.find((e) => e.id === employeeId);
    const task = data.tasks.find((t) => t.stages.some((s) => s.id === stageId));
    const stage = task?.stages.find((s) => s.id === stageId);
    if (!emp || !task || !stage) return;
    if (stageOverlapsUnavailable(emp, isoDate, stage.durationDays)) return;
    if (!pinRespectsOrder(task, stageId, isoDate, result)) return;
    editData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => ({
        ...t,
        stages: t.stages.map((s) =>
          s.id === stageId
            ? { ...s, assigneeId: employeeId, pinnedStartDate: isoDate }
            : s,
        ),
      })),
    }));
    const who = stage.assigneeId !== employeeId ? ` · ${emp.name}` : '';
    toast(`Этап закреплён на ${formatShort(isoDate)}${who}`, { action: undoAction });
    track('stage_pinned');
  };

  // Сняли закрепление — этап возвращается в авторазмещение.
  const unpinStage = (stageId: string) => {
    editData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => ({
        ...t,
        stages: t.stages.map((s) =>
          s.id === stageId ? { ...s, pinnedStartDate: null } : s,
        ),
      })),
    }));
    toast('Закрепление снято — этап снова размещается автоматически', {
      action: undoAction,
    });
  };

  // Клик по блоку на ганте или строке таблицы — открыть задачу в панели.
  const openTask = (taskId: string) => {
    const task = data.tasks.find((t) => t.id === taskId);
    if (task) setDrawer({ mode: 'edit', task });
  };

  // Завершённые не в счёт: их закрепления — заморозка истории, а не ручные
  // перетаскивания, «Сбросить закрепления» их не трогает. Счётчик виден
  // рядом с гантом — пользователь понимает, сколько этапов держит вручную.
  const pinnedCount = useMemo(
    () =>
      viewData.tasks.reduce(
        (n, t) =>
          t.done ? n : n + t.stages.filter((s) => s.pinnedStartDate).length,
        0,
      ),
    [viewData.tasks],
  );

  // Снять ручные закрепления активной команды — страховка, если запутался
  // в перетаскиваниях. Чужие команды и завершённые задачи не трогаем.
  const resetPins = async () => {
    const ok = await confirm({
      title: `Сбросить закрепления (${pinnedCount})?`,
      text: 'Этапы, которые вы двигали руками, снова разместятся автоматически по приоритетам. Завершённые задачи не пострадают.',
      confirmLabel: 'Сбросить',
    });
    if (!ok) return;
    editData((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.done || t.teamId !== effectiveTeamId
          ? t
          : {
              ...t,
              stages: t.stages.map((s) => ({ ...s, pinnedStartDate: null })),
            },
      ),
    }));
    toast(`Сброшено закреплений: ${pinnedCount}`, { action: undoAction });
  };

  // --- Управление составом ---
  // Новый сотрудник заводится в активной команде.
  const addEmployee = (name: string, specialization: Specialization) => {
    editData((d) => ({
      ...d,
      employees: [
        ...d.employees,
        { id: newId(), name, specialization, teamId: effectiveTeamId, unavailable: [] },
      ],
    }));
    track('employee_added');
  };

  const updateEmployee = (id: string, patch: Partial<Employee>) =>
    editData((d) => ({
      ...d,
      employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  // Удаление человека снимает его со всех этапов (assigneeId → null).
  const deleteEmployee = (id: string) =>
    editData((d) => ({
      ...d,
      employees: d.employees.filter((e) => e.id !== id),
      tasks: d.tasks.map((t) => ({
        ...t,
        stages: t.stages.map((s) =>
          s.assigneeId === id ? { ...s, assigneeId: null } : s,
        ),
      })),
    }));

  // --- Управление командами ---
  // Новая команда создаётся с именем по умолчанию и сразу открывается на
  // переименование прямо во вкладке.
  const addTeam = () => {
    const id = newId();
    const name = `Команда ${data.teams.length + 1}`;
    editData((d) => ({ ...d, teams: [...d.teams, { id, name }] }));
    setActiveTeam(id);
    setRenamingTeamId(id);
    toast(`Команда «${name}» создана`, { action: undoAction });
  };

  const renameTeam = (id: string, name: string) =>
    editData((d) => ({
      ...d,
      teams: d.teams.map((t) => (t.id === id ? { ...t, name } : t)),
    }));

  // Удаление команды каскадно уносит её людей и задачи. Последнюю команду
  // удалить нельзя — план всегда содержит хотя бы одну.
  const deleteTeam = async () => {
    if (data.teams.length <= 1) return;
    const cur = data.teams.find((t) => t.id === effectiveTeamId);
    if (!cur) return;
    const emps = data.employees.filter((e) => e.teamId === cur.id).length;
    const tks = data.tasks.filter((t) => t.teamId === cur.id).length;
    const ok = await confirm({
      title: `Удалить команду «${cur.name}»?`,
      text: `Вместе с ней удалятся ${emps} чел. и ${tks} задач. Отменить можно сразу после удаления.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    const rest = data.teams.filter((t) => t.id !== cur.id);
    editData((d) => ({
      ...d,
      teams: rest,
      employees: d.employees.filter((e) => e.teamId !== cur.id),
      tasks: d.tasks.filter((t) => t.teamId !== cur.id),
    }));
    setActiveTeam(rest[0].id);
    toast(`Команда «${cur.name}» удалена`, { action: undoAction });
  };

  const loadDemo = async () => {
    const ok = await confirm({
      title: 'Заменить план демо-данными?',
      text: 'Текущие команды, люди и задачи заменятся примером. Вернуть свой план можно отменой.',
      confirmLabel: 'Заменить',
    });
    if (!ok) return;
    editData(makeSampleData());
    setHandle(null);
    toast('Загружены демо-данные', { action: undoAction });
  };

  async function onSave() {
    try {
      const h = await saveToFile(data, handle);
      if (h) setHandle(h);
      toast('Сохранено в файл');
    } catch {
      toast('Сохранение отменено');
    }
  }

  async function onLoad() {
    try {
      const { data: loaded, handle: h } = await openFromFile();
      editData(loaded);
      setHandle(h);
      toast('План загружен из файла', { action: undoAction });
    } catch {
      toast('Загрузка отменена');
    }
  }

  // Опубликовать план и получить постоянную ссылку для коллег (только просмотр).
  // Пока публикация идёт, кнопка заблокирована — двойной клик не даст два POST.
  const onShare = async () => {
    if (sharingRef.current) return;
    // Делимся активной командой. Перед первой её публикацией предупреждаем:
    // имена людей и их отсутствия уедут на сервер и станут видны по ссылке.
    if (!getShareId(effectiveTeamId)) {
      const ok = await confirm({
        title: 'Опубликовать план по ссылке?',
        text: 'На сервер уедет план активной команды и станет доступен всем, у кого есть ссылка, — включая имена сотрудников и их отпуска. Отозвать ссылку можно в любой момент в меню «Файл».',
        confirmLabel: 'Опубликовать',
      });
      if (!ok) return;
    }
    sharingRef.current = true;
    setSharing(true);
    try {
      const id = await publishPlan(effectiveTeamId, viewData);
      const url = shareUrl(id);
      setShareLink(url);
      track('plan_shared', {
        tasks: viewData.tasks.length,
        employees: viewData.employees.length,
      });
      try {
        await navigator.clipboard?.writeText(url);
        toast('Ссылка скопирована — отправьте коллегам');
      } catch {
        toast('Ссылка готова — скопируйте её в плашке над планом');
      }
    } catch (err) {
      setShareLink('');
      if (err instanceof WrongEditKeyError) {
        // Наш секрет не подошёл к сохранённой ссылке — забываем её;
        // следующее «Поделиться» создаст новую.
        clearShare(effectiveTeamId);
        toast('Старую ссылку обновить не удалось — нажмите «Поделиться» ещё раз, будет создана новая.', {
          kind: 'error',
        });
      } else {
        toast('Не удалось опубликовать. Подключено ли хранилище в Vercel?', { kind: 'error' });
      }
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  // Отозвать ссылку активной команды: план удаляется с сервера, у коллег перестаёт открываться.
  const onRevoke = async () => {
    const ok = await confirm({
      title: 'Отозвать ссылку?',
      text: 'План активной команды будет удалён с сервера, ссылка у коллег перестанет открываться.',
      confirmLabel: 'Отозвать',
      danger: true,
    });
    if (!ok) return;
    try {
      await revokePlan(effectiveTeamId);
      setShareLink('');
      toast('Ссылка отозвана — план удалён с сервера');
    } catch (err) {
      if (err instanceof WrongEditKeyError) {
        // Удалить с сервера не можем (секрет не наш) — хотя бы забываем локально.
        clearShare(effectiveTeamId);
        setShareLink('');
        toast('Ссылка забыта, но удалить план с сервера не удалось — секрет не подошёл.', {
          kind: 'error',
        });
      } else {
        toast('Не удалось отозвать ссылку — попробуйте ещё раз', { kind: 'error' });
      }
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast('Ссылка скопирована');
    } catch {
      toast('Не удалось скопировать — выделите ссылку и нажмите Ctrl+C');
    }
  };

  const exportMd = () => {
    downloadMarkdown(viewData, result);
    track('export_md');
    toast('Выгружено в team-plan.md');
  };

  const noop = () => {};

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10 text-muted">
        Загрузка плана…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-lg font-bold">План не найден</p>
        <p className="text-sm text-muted">
          Ссылка устарела или план был удалён. Попросите автора прислать
          актуальную ссылку.
        </p>
        <a href={location.origin + location.pathname} className={buttonClass('primary')}>
          Открыть свой планировщик
        </a>
      </div>
    );
  }

  const horizonOptions = HORIZON_OPTIONS.includes(data.horizonWeeks)
    ? HORIZON_OPTIONS
    : [...HORIZON_OPTIONS, data.horizonWeeks].sort((a, b) => a - b);

  // Шапка карточки ганта: заголовок с диапазоном и горизонт.
  const ganttHeadStart = (
    <>
      <h2 className="flex items-baseline gap-2.5 text-[15px] font-extrabold tracking-tight">
        План
        {visibleDays > 0 && (
          <small className="text-[12.5px] font-semibold text-faint tabular-nums">
            {rangeLabel(ganttResult.days[0], shown.days[visibleDays - 1])}
          </small>
        )}
      </h2>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Горизонт плана, недель"
            className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-2 p-0.5"
          >
            {horizonOptions.map((w) => (
              <button
                key={w}
                aria-pressed={data.horizonWeeks === w}
                onClick={() => setHorizonWeeks(w)}
                className={`h-7 cursor-pointer rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap ${
                  data.horizonWeeks === w
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_var(--color-line)]'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {w} нед.
              </button>
            ))}
          </div>
          <IconButton
            label={
              canShiftHorizon
                ? 'К текущей неделе: прошлое фиксируется, даты релизов не меняются'
                : 'Начало плана уже на прошлой неделе'
            }
            size="sm"
            onClick={shiftHorizon}
            disabled={!canShiftHorizon}
          >
            <ArrowLeftToLine size={16} />
          </IconButton>
        </div>
      )}
    </>
  );

  const ganttHeadEnd = (
    <>
      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-muted select-none">
        <input
          type="checkbox"
          checked={showReleases}
          onChange={toggleReleases}
          className="relative h-[18px] w-[30px] cursor-pointer appearance-none rounded-full bg-line transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] checked:bg-primary checked:after:translate-x-3"
        />
        Релизы
      </label>
      {pastStart && (
        <Tip label="Показать этапы до начала плана. На расчёт и даты релизов не влияет">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-muted select-none">
            <input
              type="checkbox"
              checked={showPast}
              onChange={togglePast}
              className="relative h-[18px] w-[30px] cursor-pointer appearance-none rounded-full bg-line transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] checked:bg-primary checked:after:translate-x-3"
            />
            Прошлое
          </label>
        </Tip>
      )}
      {!readOnly && pinnedCount > 0 && (
        <Tip label="Снять все ручные закрепления и вернуть автопланирование">
          <Button size="sm" variant="ghost" onClick={resetPins}>
            <PinOff size={14} />
            Сбросить закрепления · {pinnedCount}
          </Button>
        </Tip>
      )}
      {ganttFull && !readOnly && (
        <>
          <IconButton label="Отменить" shortcut="Ctrl+Z" size="sm" onClick={undo} disabled={!canUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Повторить" shortcut="Ctrl+Shift+Z" size="sm" onClick={redo} disabled={!canRedo}>
            <Redo2 size={16} />
          </IconButton>
        </>
      )}
      <IconButton
        label={ganttFull ? 'Свернуть гант' : 'Гант на весь экран'}
        shortcut={ganttFull ? 'Esc' : undefined}
        size="sm"
        onClick={() => setGanttFull((v) => !v)}
      >
        {ganttFull ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </IconButton>
    </>
  );

  // Гант один и тот же в обычном виде и в фокус-режиме — меняется только обёртка.
  const ganttEl = (
    <GanttChart
      ref={ganttRef}
      data={previewView}
      result={ganttResult}
      showReleases={showReleases}
      fillHeight={ganttFull}
      readOnly={readOnly}
      onMoveStage={readOnly ? noop : moveStage}
      onUnpinStage={readOnly ? noop : unpinStage}
      onOpenTask={readOnly ? noop : openTask}
      highlightTaskId={drawer ? (draft?.id ?? null) : hoverTaskId}
      onHoverTask={setHoverTaskId}
      onManagePeople={() => setShowTeam(true)}
      headStart={ganttHeadStart}
      headEnd={ganttHeadEnd}
    />
  );

  const themeButton = (
    <IconButton
      label={theme.resolved === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      onClick={theme.toggle}
    >
      {theme.resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </IconButton>
  );

  return (
    <div className="flex min-h-full flex-col">
      {/* Шапка: команды слева, действия справа. Всё, что нажимается нечасто
          (сотрудники, отчёт, файловые операции, демо), — в меню «Файл». */}
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-white">
            <ChartGantt size={16} />
          </span>
          <h1 className="hidden text-[15px] font-extrabold tracking-tight whitespace-nowrap sm:block">
            Планировщик ресурсов
          </h1>
        </div>
        <TeamTabs
          teams={data.teams}
          activeId={effectiveTeamId}
          onSelect={setActiveTeam}
          onAdd={readOnly ? undefined : addTeam}
          onRename={readOnly ? undefined : renameTeam}
          editingId={renamingTeamId}
          onEditingChange={setRenamingTeamId}
        />
        <span className="hidden text-[13px] font-semibold whitespace-nowrap text-faint lg:inline">
          {taskCountLabel}
        </span>
        <div className="flex-1" />

        {readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-muted">
              <Eye size={14} />
              Только просмотр
            </span>
            {themeButton}
            <Button onClick={() => setShowReport(true)}>
              <BarChart3 size={16} />
              Отчёт
            </Button>
            <Tip label="Скачать план таблицей в markdown (.md)">
              <Button onClick={exportMd}>
                <Download size={16} />
                .md
              </Button>
            </Tip>
            <a href={location.origin + location.pathname} className={buttonClass('primary')}>
              Создать свой план
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <IconButton label="Отменить" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo}>
                <Undo2 size={17} />
              </IconButton>
              <IconButton label="Повторить" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo}>
                <Redo2 size={17} />
              </IconButton>
              <span className="mx-0.5 h-[22px] w-px bg-line" aria-hidden />
              <WarningsButton warnings={shown.warnings} />
              <IconButton label="Управление и клавиши" shortcut="?" onClick={() => setShowHelp(true)}>
                <Keyboard size={17} />
              </IconButton>
              {themeButton}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tip label="Новая задача" shortcut="N">
                <Button variant="primary" onClick={() => setDrawer({ mode: 'new' })}>
                  <Plus size={16} />
                  Задача
                </Button>
              </Tip>
              <Tip label="Срочная задача: видно, кого заденет, до внесения в план">
                <Button onClick={() => setDrawer({ mode: 'urgent' })}>
                  <Zap size={16} className="text-warning" />
                  Срочная
                </Button>
              </Tip>
              <Menu>
                <MenuTrigger asChild>
                  <Button>
                    Файл
                    <ChevronDown size={14} />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Users size={16} />} onSelect={() => setShowTeam(true)}>
                    Сотрудники
                  </MenuItem>
                  <MenuItem icon={<BarChart3 size={16} />} onSelect={() => setShowReport(true)}>
                    Отчёт за период
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>Команда</MenuLabel>
                  <MenuItem
                    icon={<PencilLine size={16} />}
                    onSelect={() => setRenamingTeamId(effectiveTeamId)}
                  >
                    Переименовать команду
                  </MenuItem>
                  <MenuItem icon={<Plus size={16} />} onSelect={addTeam}>
                    Добавить команду
                  </MenuItem>
                  <MenuItem
                    icon={<Trash2 size={16} />}
                    danger
                    disabled={data.teams.length <= 1}
                    onSelect={deleteTeam}
                  >
                    Удалить команду
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>План</MenuLabel>
                  <MenuItem icon={<Save size={16} />} shortcut="Ctrl+S" onSelect={onSave}>
                    Сохранить в файл
                  </MenuItem>
                  <MenuItem icon={<FolderOpen size={16} />} shortcut="Ctrl+O" onSelect={onLoad}>
                    Загрузить из файла
                  </MenuItem>
                  <MenuItem icon={<Download size={16} />} onSelect={exportMd}>
                    Экспорт .md
                  </MenuItem>
                  {!hasFileSystemAccess() && (
                    <MenuNote>
                      Браузер не умеет писать прямо в файл — план скачивается и
                      загружается через диалог. Лучше открыть в Chrome или Edge.
                    </MenuNote>
                  )}
                  {getShareId(effectiveTeamId) && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Link2Off size={16} />} danger onSelect={onRevoke}>
                        Отозвать ссылку
                      </MenuItem>
                    </>
                  )}
                  <MenuSeparator />
                  <MenuItem icon={<RotateCcw size={16} />} onSelect={loadDemo}>
                    Демо-данные
                  </MenuItem>
                </MenuContent>
              </Menu>
              <Tip label="Опубликовать план и получить ссылку для коллег (только просмотр)">
                <Button variant="soft" onClick={onShare} disabled={sharing}>
                  <Link2 size={16} />
                  {sharing ? 'Публикую…' : 'Поделиться'}
                </Button>
              </Tip>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto grid w-full max-w-[1680px] gap-4 px-4 pt-4 pb-24">
        {shareLink && !readOnly && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-success-light px-3 py-2 text-[13px]">
            <Link2 size={15} className="text-success-ink" />
            <span className="font-bold text-success-ink">Ссылка для коллег</span>
            <input
              readOnly
              value={shareLink}
              aria-label="Ссылка на план"
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-[200px] flex-1 rounded-lg border border-line bg-surface px-2.5 text-ink"
            />
            <Button size="sm" onClick={copyShareLink}>
              <Copy size={14} />
              Копировать
            </Button>
            <span className="text-xs text-muted">
              Повторное «Поделиться» обновляет план по той же ссылке
            </span>
            <IconButton label="Скрыть" size="sm" onClick={() => setShareLink('')}>
              <X size={15} />
            </IconButton>
          </div>
        )}

        {showShiftNudge && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-primary-light px-3 py-2 text-[13px]">
            <span>
              Начало плана — {formatShort(data.horizonStart)}, это{' '}
              {Math.round(horizonLagDays / 7)} нед. назад. Прошлое можно
              отрезать — даты релизов не сдвинутся.
            </span>
            <Button size="sm" onClick={shiftHorizon}>
              <ArrowLeftToLine size={14} />
              К текущей неделе
            </Button>
            <IconButton label="Скрыть до завтра" size="sm" className="ml-auto" onClick={dismissNudge}>
              <X size={15} />
            </IconButton>
          </div>
        )}

        {!ganttFull ? (
          ganttEl
        ) : (
          /* Фокус-режим: гант на всё окно. Окна задач открываются поверх. */
          <div className="fixed inset-0 z-50 flex flex-col bg-bg p-3">
            <div className="min-h-0 flex-1">{ganttEl}</div>
          </div>
        )}

        <ReleasesTable
          activeReleases={activeReleases}
          doneReleases={doneReleases}
          tasks={previewView.tasks}
          employees={viewData.employees}
          lastVisibleDate={lastVisibleDate}
          readOnly={readOnly}
          highlightTaskId={hoverTaskId}
          selectedTaskId={drawer ? (draft?.id ?? null) : null}
          releasesBefore={
            drawer ? new Map(result.releases.map((r) => [r.taskId, r.releaseDate])) : null
          }
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onHoverTask={setHoverTaskId}
          onOpenTask={openTask}
          onSetPriority={setPriority}
          onComplete={markDone}
          onReopen={markActive}
          onDelete={deleteTask}
          onExportCsv={() => {
            downloadReleasesCsv(activeReleases, viewData.tasks);
            track('export_csv');
          }}
        />
      </main>

      {drawer && (
        <TaskDrawer
          key={drawer.task?.id ?? drawer.mode}
          mode={drawer.mode}
          initialTask={drawer.task}
          defaultPriority={nextPriority}
          employees={viewData.employees}
          impact={drawerImpact}
          onDraftChange={setDraft}
          onSave={(task) => {
            if (drawer.mode === 'edit') updateTask(task);
            else addTask(task);
            closeDrawer();
          }}
          onDelete={
            drawer.task
              ? () => {
                  deleteTask(drawer.task!.id);
                  closeDrawer();
                }
              : undefined
          }
          onClose={closeDrawer}
        />
      )}

      {showReport && (
        <ReportModal data={viewData} result={result} onClose={() => setShowReport(false)} />
      )}

      {showTeam && (
        <EmployeeManager
          employees={viewData.employees}
          onAdd={addEmployee}
          onUpdate={updateEmployee}
          onDelete={deleteEmployee}
          onClose={() => setShowTeam(false)}
        />
      )}

      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
