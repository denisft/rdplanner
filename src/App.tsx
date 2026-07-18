import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Employee, Specialization, Task, Team } from './types';
import { schedule, stageOverlapsUnavailable } from './engine/scheduler';
import { teamView } from './engine/teams';
import { completeTask, reopenTask } from './engine/complete';
import { shiftHorizonStart, shiftTarget } from './engine/horizon';
import { formatISO, parseISO, SHORT_MONTHS, SHORT_WEEKDAYS } from './engine/dates';
import { GanttChart } from './components/GanttChart';
import { TaskForm } from './components/TaskForm';
import { UrgentTaskModal } from './components/UrgentTaskModal';
import { EmployeeManager } from './components/EmployeeManager';
import { ReportModal } from './components/ReportModal';
import { PRIORITY_STYLE, UNAVAILABLE_STRIPES } from './components/stageStyle';
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

function formatFull(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** Дата релиза с днём недели, напр. "18 июн, чт". */
function formatRelease(iso: string | null): string {
  if (!iso) return '—';
  return `${formatFull(iso)}, ${SHORT_WEEKDAYS[parseISO(iso).getDay()]}`;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Статусное сообщение под тулбаром: успех гаснет сам, ошибка висит,
// пока пользователь не закроет её или не повторит действие.
type Status = { text: string; kind: 'ok' | 'error' };

// Настройка вида «показывать релизы на ганте» — личное предпочтение зрителя,
// поэтому живёт в localStorage, а не в данных плана (файл/общая ссылка).
const SHOW_RELEASES_KEY = 'resource-planner:show-releases';

// Плашка «сдвиньте начало горизонта»: закрытие запоминается до конца дня.
// Тоже настройка вида — в localStorage, не в AppData.
const SHIFT_NUDGE_KEY = 'resource-planner:shift-nudge-dismissed';

// Активная команда — личная настройка вида (какую вкладку смотрит зритель),
// поэтому в localStorage, а не в AppData.
const ACTIVE_TEAM_KEY = 'resource-planner:active-team';

function loadShowReleases(): boolean {
  try {
    return localStorage.getItem(SHOW_RELEASES_KEY) !== '0';
  } catch {
    return true;
  }
}

function loadActiveTeam(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TEAM_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  // Если открыли по общей ссылке (?plan=...) — режим только-чтения.
  const sharedId = useMemo(() => planIdFromUrl(), []);
  const readOnly = sharedId !== null;

  const [data, setData] = useState<AppData>(() =>
    readOnly ? makeSampleData() : loadAutosave() ?? makeSampleData(),
  );
  // Стеки отмены/повтора снимков data для перетаскиваний на ганте.
  const [undoStack, setUndoStack] = useState<AppData[]>([]);
  const [redoStack, setRedoStack] = useState<AppData[]>([]);
  const [handle, setHandle] = useState<FsFileHandle | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Модалка «Срочная задача» (БЛ-17): предпросмотр удара до внесения в план.
  const [showUrgent, setShowUrgent] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  // Модалка «Отчёт за период» — доступна и в режиме просмотра по ссылке.
  const [showReport, setShowReport] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
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
  // Секция «Завершённые» в таблице релизов: свёрнута по умолчанию.
  const [showDone, setShowDone] = useState(false);
  // Меню «Файл» в тулбаре: редкие файловые операции собраны в дропдаун,
  // закрывается по клику мимо или Esc.
  const [showFileMenu, setShowFileMenu] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFileMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!fileMenuRef.current?.contains(e.target as Node))
        setShowFileMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFileMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showFileMenu]);

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

  // Успешный статус гаснет сам; ошибка остаётся до закрытия крестиком.
  useEffect(() => {
    if (!status || status.kind !== 'ok') return;
    const t = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status]);

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
    try {
      localStorage.setItem(ACTIVE_TEAM_KEY, id);
    } catch {
      // приватный режим — просто не запомним выбор
    }
  };

  // Загрузка опубликованного плана при открытии по ссылке.
  useEffect(() => {
    if (!sharedId) return;
    fetchSharedPlan(sharedId)
      .then((d) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [sharedId]);

  // Срез по активной команде: на нём считаем гант, релизы, отчёт и экспорт.
  // Полный data остаётся источником истины (автосейв, setData).
  const viewData = useMemo(
    () => teamView(data, effectiveTeamId),
    [data, effectiveTeamId],
  );

  // Reflow: расписание активной команды пересчитывается при изменении её данных.
  const result = useMemo(() => schedule(viewData), [viewData]);

  // Автосохранение в localStorage (только в своём режиме редактирования).
  useEffect(() => {
    if (!readOnly) autosave(data);
  }, [data, readOnly]);

  const visibleDays = data.horizonWeeks * 5;

  // Счётчик в шапке — по активной команде; завершённые не смешиваем с работой.
  const activeTaskCount = viewData.tasks.filter((t) => !t.done).length;
  const doneTaskCount = viewData.tasks.length - activeTaskCount;
  const taskCountLabel =
    `${viewData.employees.length} чел · ${activeTaskCount} задач` +
    (doneTaskCount > 0 ? ` · ${doneTaskCount} завершено` : '');

  const releasesSorted = useMemo(
    () => [...result.releases].sort((a, b) => a.qaEndIndex - b.qaEndIndex),
    [result.releases],
  );

  // Таблица: активные — сверху как раньше, завершённые — в свёрнутую секцию
  // (свежезавершённые первыми).
  const activeReleases = useMemo(
    () => releasesSorted.filter((r) => !r.done),
    [releasesSorted],
  );
  const doneReleases = useMemo(() => {
    const completedAt = new Map(viewData.tasks.map((t) => [t.id, t.completedAt ?? '']));
    return releasesSorted
      .filter((r) => r.done)
      .sort((a, b) =>
        (completedAt.get(b.taskId) ?? '').localeCompare(
          completedAt.get(a.taskId) ?? '',
        ),
      );
  }, [releasesSorted, viewData.tasks]);

  // Последний видимый день горизонта — для пометки «за горизонтом».
  const lastVisibleDate = result.days[visibleDays - 1] ?? null;

  const nextPriority = useMemo(() => {
    const min = viewData.tasks.reduce((m, t) => Math.min(m, t.priority), 3);
    return Math.max(1, min);
  }, [viewData.tasks]);

  // Новая задача попадает в активную команду.
  const addTask = (task: Task) =>
    setData((d) => ({
      ...d,
      tasks: [...d.tasks, { ...task, teamId: effectiveTeamId }],
    }));

  const updateTask = (task: Task) =>
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? task : t)),
    }));

  const deleteTask = (id: string) =>
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));

  // Отметить задачу завершённой: этапы замораживаются на текущих датах,
  // блоки на ганте сереют, строка уезжает в секцию «Завершённые».
  const markDone = (taskId: string) => {
    pushUndo();
    setData(completeTask(data, result, taskId, formatISO(new Date())));
  };

  // Вернуть завершённую в работу (закрепления этапов остаются на месте).
  const markActive = (taskId: string) => {
    pushUndo();
    setData(reopenTask(data, taskId));
  };

  const setPriority = (id: string, priority: number) =>
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, priority } : t)),
    }));

  const setHorizonWeeks = (w: number) =>
    setData((d) => ({ ...d, horizonWeeks: w }));

  // Запомнить текущий снимок перед изменением и очистить стек повтора.
  const pushUndo = () => {
    setUndoStack((h) => [...h.slice(-49), data]);
    setRedoStack([]);
  };

  // Откатить последнее перетаскивание (Ctrl+Z).
  const undo = () => {
    setUndoStack((past) => {
      if (past.length === 0) return past;
      setRedoStack((r) => [...r, data]);
      setData(past[past.length - 1]);
      return past.slice(0, -1);
    });
  };

  // Вернуть отменённое (Ctrl+Shift+Z / Ctrl+Y).
  const redo = () => {
    setRedoStack((future) => {
      if (future.length === 0) return future;
      setUndoStack((u) => [...u, data]);
      setData(future[future.length - 1]);
      return future.slice(0, -1);
    });
  };

  // Сдвиг начала горизонта к текущей неделе (минус неделя контекста):
  // не перепланирование, а фиксация прошлого — даты релизов не меняются.
  const todayISO = formatISO(new Date());
  const horizonTarget = shiftTarget(todayISO);
  const canShiftHorizon = data.horizonStart < horizonTarget;
  const shiftHorizon = () => {
    pushUndo();
    // Сдвиг горизонта — операция над всем планом (общая шкала), поэтому
    // фиксируем прошлое по расписанию всех команд, а не только активной.
    const fullResult = schedule(data);
    setData(shiftHorizonStart(data, fullResult, horizonTarget));
    setStatus({
      text: `Начало горизонта — ${formatFull(horizonTarget)}. Даты релизов не изменились; Ctrl+Z — вернуть.`,
      kind: 'ok',
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

  // Горячие клавиши: Ctrl/Cmd+Z — отмена, Ctrl+Shift+Z / Ctrl+Y — повтор.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Не перехватываем, когда пользователь печатает в поле ввода.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Esc — выход из фокус-режима ганта. Модалки (z-50) открываются поверх
  // оверлея (z-40), поэтому пока открыта модалка, Esc фокус-режим не трогает.
  useEffect(() => {
    if (!ganttFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showForm || editingTask || showTeam || showReport || showUrgent) return;
      setGanttFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ganttFull, showForm, editingTask, showTeam, showReport, showUrgent]);

  // Перетащили этап на сотрудника и день — закрепляем вручную.
  // Бросок, при котором блок этапа лёг бы на отпуск/больничный исполнителя,
  // молча отклоняется (гант такие цели и не подсвечивает — это второй рубеж).
  const moveStage = (stageId: string, employeeId: string, isoDate: string) => {
    const emp = data.employees.find((e) => e.id === employeeId);
    const stage = data.tasks
      .flatMap((t) => t.stages)
      .find((s) => s.id === stageId);
    if (!emp || !stage) return;
    if (stageOverlapsUnavailable(emp, isoDate, stage.durationDays)) return;
    pushUndo();
    setData((d) => ({
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
  };

  // Сняли закрепление — этап возвращается в авторазмещение.
  const unpinStage = (stageId: string) => {
    pushUndo();
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => ({
        ...t,
        stages: t.stages.map((s) =>
          s.id === stageId ? { ...s, pinnedStartDate: null } : s,
        ),
      })),
    }));
  };

  // Alt+двойной клик по блоку на ганте — открыть задачу на редактирование.
  const editTaskById = (taskId: string) => {
    const task = data.tasks.find((t) => t.id === taskId);
    if (task) setEditingTask(task);
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
  const resetPins = () => {
    pushUndo();
    setData((d) => ({
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
  };

  // --- Управление составом ---
  // Новый сотрудник заводится в активной команде.
  const addEmployee = (name: string, specialization: Specialization) =>
    setData((d) => ({
      ...d,
      employees: [
        ...d.employees,
        { id: newId(), name, specialization, teamId: effectiveTeamId, unavailable: [] },
      ],
    }));

  const updateEmployee = (id: string, patch: Partial<Employee>) =>
    setData((d) => ({
      ...d,
      employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  // Удаление человека снимает его со всех этапов (assigneeId → null).
  const deleteEmployee = (id: string) =>
    setData((d) => ({
      ...d,
      employees: d.employees.filter((e) => e.id !== id),
      tasks: d.tasks.map((t) => ({
        ...t,
        stages: t.stages.map((s) =>
          s.assigneeId === id ? { ...s, assigneeId: null } : s,
        ),
      })),
    }));

  // --- Управление командами (меню «Файл») ---
  const addTeam = () => {
    const name = window.prompt(
      'Название новой команды:',
      `Команда ${data.teams.length + 1}`,
    );
    if (!name?.trim()) return;
    const id = newId();
    pushUndo();
    setData((d) => ({ ...d, teams: [...d.teams, { id, name: name.trim() }] }));
    setActiveTeam(id);
    setStatus({ text: `Команда «${name.trim()}» создана`, kind: 'ok' });
  };

  const renameTeam = () => {
    const cur = data.teams.find((t) => t.id === effectiveTeamId);
    if (!cur) return;
    const name = window.prompt('Новое название команды:', cur.name);
    if (!name?.trim()) return;
    setData((d) => ({
      ...d,
      teams: d.teams.map((t) =>
        t.id === cur.id ? { ...t, name: name.trim() } : t,
      ),
    }));
  };

  // Удаление команды каскадно уносит её людей и задачи. Последнюю команду
  // удалить нельзя — план всегда содержит хотя бы одну.
  const deleteTeam = () => {
    if (data.teams.length <= 1) return;
    const cur = data.teams.find((t) => t.id === effectiveTeamId);
    if (!cur) return;
    const emps = data.employees.filter((e) => e.teamId === cur.id).length;
    const tks = data.tasks.filter((t) => t.teamId === cur.id).length;
    if (
      !window.confirm(
        `Удалить команду «${cur.name}»? Вместе с ней удалятся ${emps} чел. и ${tks} задач. Ctrl+Z вернёт.`,
      )
    )
      return;
    pushUndo();
    const rest = data.teams.filter((t) => t.id !== cur.id);
    setData((d) => ({
      ...d,
      teams: rest,
      employees: d.employees.filter((e) => e.teamId !== cur.id),
      tasks: d.tasks.filter((t) => t.teamId !== cur.id),
    }));
    setActiveTeam(rest[0].id);
    setStatus({ text: `Команда «${cur.name}» удалена. Ctrl+Z — вернуть.`, kind: 'ok' });
  };

  const onSave = async () => {
    try {
      const h = await saveToFile(data, handle);
      if (h) setHandle(h);
      setStatus({ text: 'Сохранено в файл', kind: 'ok' });
    } catch {
      setStatus({ text: 'Сохранение отменено', kind: 'ok' });
    }
  };

  const onLoad = async () => {
    try {
      const { data: loaded, handle: h } = await openFromFile();
      setData(loaded);
      setHandle(h);
      setStatus({ text: 'Загружено из файла', kind: 'ok' });
    } catch {
      setStatus({ text: 'Загрузка отменена', kind: 'ok' });
    }
  };

  // Опубликовать план и получить постоянную ссылку для коллег (только просмотр).
  // Пока публикация идёт, кнопка заблокирована — двойной клик не даст два POST.
  const onShare = async () => {
    if (sharingRef.current) return;
    // Делимся активной командой. Перед первой её публикацией предупреждаем:
    // имена людей и их отсутствия уедут на сервер и станут видны по ссылке.
    if (
      !getShareId(effectiveTeamId) &&
      !window.confirm(
        'На сервер уедет план активной команды и станет доступен всем, у кого есть ссылка, — включая имена сотрудников и их отпуска.\n\nСсылку можно отозвать в любой момент: Файл → «Отозвать ссылку». Продолжить?',
      )
    )
      return;
    sharingRef.current = true;
    setSharing(true);
    setStatus(null);
    try {
      const id = await publishPlan(effectiveTeamId, viewData);
      const url = shareUrl(id);
      setShareLink(url);
      try {
        await navigator.clipboard?.writeText(url);
        setStatus({ text: 'Ссылка скопирована — отправьте коллегам', kind: 'ok' });
      } catch {
        setStatus({ text: 'Ссылка готова — скопируйте её ниже', kind: 'ok' });
      }
    } catch (err) {
      setShareLink('');
      if (err instanceof WrongEditKeyError) {
        // Наш секрет не подошёл к сохранённой ссылке — забываем её;
        // следующее «Поделиться» создаст новую.
        clearShare(effectiveTeamId);
        setStatus({
          text: 'Старую ссылку обновить не удалось — нажмите «Поделиться» ещё раз, будет создана новая.',
          kind: 'error',
        });
      } else {
        setStatus({
          text: 'Не удалось опубликовать. Подключено ли хранилище в Vercel?',
          kind: 'error',
        });
      }
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  // Отозвать ссылку активной команды: план удаляется с сервера, у коллег перестаёт открываться.
  const onRevoke = async () => {
    if (
      !window.confirm(
        'Отозвать ссылку активной команды? План будет удалён с сервера, ссылка у коллег перестанет открываться.',
      )
    )
      return;
    setStatus(null);
    try {
      await revokePlan(effectiveTeamId);
      setShareLink('');
      setStatus({ text: 'Ссылка отозвана — план удалён с сервера', kind: 'ok' });
    } catch (err) {
      if (err instanceof WrongEditKeyError) {
        // Удалить с сервера не можем (секрет не наш) — хотя бы забываем локально.
        clearShare(effectiveTeamId);
        setShareLink('');
        setStatus({
          text: 'Ссылка забыта, но удалить план с сервера не удалось — секрет не подошёл.',
          kind: 'error',
        });
      } else {
        setStatus({
          text: 'Не удалось отозвать ссылку — попробуйте ещё раз',
          kind: 'error',
        });
      }
    }
  };

  const noop = () => {};

  // Гант один и тот же в обычном виде и в фокус-режиме — меняется только обёртка.
  const ganttEl = (
    <GanttChart
      data={viewData}
      result={result}
      showReleases={showReleases}
      fillHeight={ganttFull}
      onMoveStage={readOnly ? noop : moveStage}
      onUnpinStage={readOnly ? noop : unpinStage}
      onEditTask={readOnly ? noop : editTaskById}
    />
  );

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10 text-slate-500">
        Загрузка плана…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-lg font-semibold text-slate-700">План не найден</p>
        <p className="text-sm text-slate-500">
          Ссылка устарела или план был удалён. Попросите автора прислать
          актуальную ссылку.
        </p>
        <a
          href={location.origin + location.pathname}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          Открыть свой планировщик
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-5 py-3 shadow-card">
        <h1 className="text-xl font-bold text-slate-800">Планировщик ресурсов</h1>
        <TeamTabs
          teams={data.teams}
          activeId={effectiveTeamId}
          onSelect={setActiveTeam}
          onAdd={readOnly ? undefined : addTeam}
        />
        <span className="text-sm text-slate-400">{taskCountLabel}</span>

        {readOnly ? (
          <div className="ml-auto flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
              👁 Просмотр — только чтение
            </span>
            <button
              onClick={() => setGanttFull(true)}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
              title="Развернуть гант на всё окно (Esc — выход)"
            >
              ⛶ Гант на весь экран
            </button>
            <button
              onClick={() => setShowReport(true)}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
              title="Отчёт за период: кто чем занят, загрузка, старты и релизы"
            >
              Отчёт
            </button>
            <button
              onClick={() => downloadMarkdown(viewData, result)}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
              title="Скачать план таблицей в markdown (.md)"
            >
              Экспорт .md
            </button>
            <a
              href={location.origin + location.pathname}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
            >
              Создать свой план
            </a>
          </div>
        ) : (
          /* Тулбар в три группы: вид, работа с планом, публикация. Всё,
             что нажимается нечасто (сотрудники, отчёт, файловые операции,
             демо), убрано в меню «Файл» — в ряду только ежедневное. */
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-slate-500">
              Горизонт:
              <input
                type="number"
                min={1}
                max={52}
                value={data.horizonWeeks}
                onChange={(e) =>
                  setHorizonWeeks(
                    Math.min(52, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center tabular-nums outline-none focus:border-primary"
              />
              нед.
            </label>
            <button
              onClick={shiftHorizon}
              disabled={!canShiftHorizon}
              title="Сдвинуть начало горизонта к текущей неделе (минус неделя контекста): прошлое фиксируется, даты релизов не меняются"
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              ⇤ К текущей неделе
            </button>
            <button
              onClick={() => setGanttFull(true)}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
              title="Развернуть гант на всё окно (Esc — выход)"
            >
              ⛶
            </button>

            <span className="h-6 w-px bg-slate-300" aria-hidden />

            <button
              onClick={() => setShowForm(true)}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
            >
              + Задача
            </button>
            <button
              onClick={() => setShowUrgent(true)}
              title="Срочная задача: предпросмотр, кого задело, до внесения в план"
              className="rounded-full border border-error/40 bg-error-light px-4 py-1.5 text-sm font-medium text-error hover:bg-error-light/70"
            >
              ⚡ Срочная
            </button>
            <button
              onClick={undo}
              disabled={undoStack.length === 0}
              title="Отменить (Ctrl+Z)"
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              ↶
            </button>
            <button
              onClick={redo}
              disabled={redoStack.length === 0}
              title="Повторить (Ctrl+Shift+Z)"
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              ↷
            </button>

            <span className="h-6 w-px bg-slate-300" aria-hidden />

            <div ref={fileMenuRef} className="relative">
              <button
                onClick={() => setShowFileMenu((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={showFileMenu}
                className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100"
              >
                Файл ▾
              </button>
              {showFileMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-slate-100 bg-white py-1.5 text-sm shadow-card"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      setShowTeam(true);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Команда: добавление, специализации, отпуска"
                  >
                    Сотрудники
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      setShowReport(true);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Отчёт за период: кто чем занят, загрузка, старты и релизы"
                  >
                    Отчёт за период
                  </button>

                  <div className="my-1 border-t border-slate-200" aria-hidden />

                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      renameTeam();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Переименовать активную команду"
                  >
                    Переименовать команду…
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      addTeam();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Создать новую команду и переключиться на неё"
                  >
                    Добавить команду…
                  </button>
                  {data.teams.length > 1 && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowFileMenu(false);
                        deleteTeam();
                      }}
                      className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-slate-100"
                      title="Удалить активную команду вместе с её людьми и задачами"
                    >
                      Удалить команду…
                    </button>
                  )}

                  <div className="my-1 border-t border-slate-200" aria-hidden />

                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      onSave();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Сохранить план в файл"
                  >
                    Сохранить в файл
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      onLoad();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Загрузить план из файла"
                  >
                    Загрузить из файла
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      downloadMarkdown(viewData, result);
                      setStatus({ text: 'Выгружено в team-plan.md', kind: 'ok' });
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Скачать план таблицей в markdown (.md)"
                  >
                    Экспорт .md
                  </button>

                  {getShareId(effectiveTeamId) && (
                    <>
                      <div
                        className="my-1 border-t border-slate-200"
                        aria-hidden
                      />
                      <button
                        role="menuitem"
                        onClick={() => {
                          setShowFileMenu(false);
                          onRevoke();
                        }}
                        className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-slate-100"
                        title="Удалить опубликованный план с сервера — ссылка у коллег перестанет открываться"
                      >
                        Отозвать ссылку…
                      </button>
                    </>
                  )}

                  <div className="my-1 border-t border-slate-200" aria-hidden />

                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFileMenu(false);
                      if (!window.confirm('Заменить текущий план демо-данными?'))
                        return;
                      pushUndo();
                      setData(makeSampleData());
                      setHandle(null);
                      setStatus({
                        text: 'Сброшено к демо-данным. Ctrl+Z — вернуть свой план.',
                        kind: 'ok',
                      });
                    }}
                    className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100"
                    title="Заменить текущий план демо-данными"
                  >
                    Демо-данные…
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onShare}
              disabled={sharing}
              className="rounded-full bg-secondary px-4 py-1.5 text-sm font-medium text-white hover:bg-secondary/90 disabled:cursor-wait disabled:opacity-60"
              title="Опубликовать план и получить ссылку для коллег (только просмотр)"
            >
              {sharing ? 'Публикую…' : 'Поделиться'}
            </button>
          </div>
        )}
      </header>

      {shareLink && !readOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-success-light px-3 py-2 text-xs">
          <span className="font-medium text-teal-700">Ссылка для коллег:</span>
          <input
            readOnly
            value={shareLink}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-slate-700"
          />
          <span className="text-teal-600">
            обновляйте кнопкой «Поделиться» — ссылка не меняется; отозвать —
            Файл → «Отозвать ссылку»
          </span>
        </div>
      )}

      {(status || !hasFileSystemAccess()) && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {status &&
            (status.kind === 'error' ? (
              <span
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-error/40 bg-error-light px-2.5 py-1.5 text-rose-700"
              >
                <span aria-hidden>⚠</span>
                {status.text}
                <button
                  onClick={() => setStatus(null)}
                  title="Закрыть сообщение"
                  className="ml-1 font-medium text-rose-400 hover:text-rose-700"
                >
                  ✕
                </button>
              </span>
            ) : (
              <span className="text-slate-500">{status.text}</span>
            ))}
          {!hasFileSystemAccess() && (
            <span className="text-amber-600">
              Браузер не поддерживает прямую запись в файл — используется
              скачивание/загрузка. Лучше открыть в Chrome или Edge.
            </span>
          )}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs text-amber-700">
          {result.warnings.slice(0, 3).map((w, i) => (
            <div key={i}>{w}</div>
          ))}
          {result.warnings.length > 3 && (
            <div>…и ещё {result.warnings.length - 3}</div>
          )}
        </div>
      )}

      {showShiftNudge && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-light px-3 py-2 text-xs text-slate-700">
          <span>
            Начало горизонта — {formatFull(data.horizonStart)}, это{' '}
            {Math.round(horizonLagDays / 7)} нед. назад. Прошлое можно
            отрезать — даты релизов не сдвинутся.
          </span>
          <button
            onClick={shiftHorizon}
            className="rounded-full border border-primary/40 bg-white px-3 py-1 font-medium text-primary hover:bg-primary/10"
          >
            ⇤ К текущей неделе
          </button>
          <button
            onClick={dismissNudge}
            title="Скрыть до завтра"
            className="ml-auto font-medium text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      )}

      {!ganttFull ? (
        ganttEl
      ) : (
        /* Фокус-режим: гант на всё окно, сверху — узкая панель с нужными
           при работе с гантом контролами. Модалки задач открываются поверх. */
        <div className="fixed inset-0 z-40 flex flex-col gap-2 bg-[#f4f7fb] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              Планировщик ресурсов
            </span>
            <span className="text-xs text-slate-400">{taskCountLabel}</span>
            <TeamTabs
              teams={data.teams}
              activeId={effectiveTeamId}
              onSelect={setActiveTeam}
              onAdd={readOnly ? undefined : addTeam}
            />
            {!readOnly && (
              <>
                <label className="ml-2 flex items-center gap-1 text-sm text-slate-500">
                  Горизонт:
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={data.horizonWeeks}
                    onChange={(e) =>
                      setHorizonWeeks(
                        Math.min(52, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center tabular-nums outline-none focus:border-primary"
                  />
                  нед.
                </label>
                <button
                  onClick={undo}
                  disabled={undoStack.length === 0}
                  title="Отменить (Ctrl+Z)"
                  className="rounded-full border border-slate-300 px-3.5 py-1 text-sm hover:bg-slate-100 disabled:opacity-40"
                >
                  ↶
                </button>
                <button
                  onClick={redo}
                  disabled={redoStack.length === 0}
                  title="Повторить (Ctrl+Shift+Z)"
                  className="rounded-full border border-slate-300 px-3.5 py-1 text-sm hover:bg-slate-100 disabled:opacity-40"
                >
                  ↷
                </button>
                {pinnedCount > 0 && (
                  <button
                    onClick={resetPins}
                    title="Снять все ручные закрепления и вернуть автопланирование"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Сбросить закрепления ({pinnedCount})
                  </button>
                )}
              </>
            )}
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-slate-500">
              <input
                type="checkbox"
                checked={showReleases}
                onChange={toggleReleases}
                className="accent-primary"
              />
              🚀 Релизы
            </label>
            <button
              onClick={() => setGanttFull(false)}
              className="ml-auto rounded-full border border-slate-300 px-3.5 py-1 text-sm hover:bg-slate-100"
            >
              ✕ Свернуть (Esc)
            </button>
          </div>
          <div className="min-h-0 flex-1">{ganttEl}</div>
        </div>
      )}

      {/* Легенда */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <Legend color="bg-primary" label="Архитектура" />
        <Legend color="bg-secondary" label="Разработка" />
        <Legend color="bg-warning" label="Ревью кода" />
        <Legend color="bg-success" label="QA" />
        <Legend color="bg-error/15 ring-2 ring-inset ring-error" label="Перегрузка (наложение)" />
        <Legend
          color="bg-slate-200 ring-1 ring-inset ring-slate-300"
          label="Завершена"
        />
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm bg-slate-200/50"
            style={{ backgroundImage: UNAVAILABLE_STRIPES }}
          />
          Отпуск / недоступность
        </span>
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={showReleases}
            onChange={toggleReleases}
            className="accent-primary"
          />
          🚀 Релизы на ганте
        </label>
        {!readOnly && pinnedCount > 0 && (
          <button
            onClick={resetPins}
            title="Снять все ручные закрепления и вернуть автопланирование"
            className="font-medium text-primary hover:underline"
          >
            Сбросить закрепления ({pinnedCount})
          </button>
        )}
        <span className="text-slate-400">
          Перетащите этап на другого человека или день, чтобы закрепить вручную.
          Двойной клик по закреплённому блоку — снять закрепление.
          Alt+двойной клик по блоку — редактировать задачу. Кнопка «сегодня» в
          шапке ганта — прокрутка к текущему дню. Ctrl+Z — отменить последнее
          действие.
        </span>
      </div>

      {/* Релизы */}
      <section className="overflow-hidden rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">
            Задачи и даты релизов
          </h2>
          <button
            onClick={() => downloadReleasesCsv(activeReleases, viewData.tasks)}
            disabled={activeReleases.length === 0}
            title="Скачать таблицу как CSV (для Excel); завершённые не выгружаются"
            className="rounded-full border border-slate-300 px-3.5 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Экспорт в CSV
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2.5 font-semibold">Приоритет</th>
              <th className="px-5 py-2.5 font-semibold">Задача</th>
              <th className="px-5 py-2.5 font-semibold">QA готово</th>
              <th className="px-5 py-2.5 font-semibold">Релиз (вт/чт)</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {activeReleases.map((rel) => {
              const task = viewData.tasks.find((t) => t.id === rel.taskId)!;
              const beyond =
                rel.releaseDate !== null &&
                lastVisibleDate !== null &&
                rel.releaseDate > lastVisibleDate;
              return (
                <tr
                  key={rel.taskId}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-5 py-2">
                    <input
                      type="number"
                      min={1}
                      value={task.priority}
                      disabled={readOnly}
                      onChange={(e) =>
                        setPriority(task.id, Number(e.target.value) || 1)
                      }
                      className={`w-14 rounded-lg border px-2 py-0.5 text-center tabular-nums disabled:opacity-60 ${PRIORITY_STYLE(
                        task.priority,
                      )}`}
                    />
                  </td>
                  <td className="px-5 py-2 font-medium text-slate-700">{rel.taskName}</td>
                  <td className="px-5 py-2 tabular-nums text-slate-500">
                    {formatFull(rel.qaEndDate)}
                  </td>
                  <td className="px-5 py-2">
                    <span className="font-medium tabular-nums text-slate-800">
                      {formatRelease(rel.releaseDate)}
                    </span>
                    {beyond && (
                      <span className="ml-2 rounded-full bg-warning-light px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        за горизонтом
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {!readOnly && (
                      <span className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => markDone(rel.taskId)}
                          title="Отметить завершённой: этапы замрут на своих датах и посереют на ганте"
                          className="text-xs text-slate-400 hover:text-emerald-600"
                        >
                          ✓ завершить
                        </button>
                        <button
                          onClick={() => setEditingTask(task)}
                          className="text-xs text-slate-400 hover:text-primary"
                        >
                          редактировать
                        </button>
                        <button
                          onClick={() => deleteTask(rel.taskId)}
                          className="text-xs text-slate-400 hover:text-rose-600"
                        >
                          удалить
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Завершённые: свёрнутая секция-архив в конце таблицы. */}
            {doneReleases.length > 0 && (
              <tr className="border-t border-slate-100 bg-slate-50">
                <td colSpan={5} className="px-5 py-1.5">
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
                  >
                    <span className="inline-block w-3 text-center">
                      {showDone ? '▾' : '▸'}
                    </span>
                    Завершённые ({doneReleases.length})
                  </button>
                </td>
              </tr>
            )}
            {showDone &&
              doneReleases.map((rel) => {
                const task = viewData.tasks.find((t) => t.id === rel.taskId)!;
                return (
                  <tr
                    key={rel.taskId}
                    className="border-t border-slate-100 text-slate-400"
                  >
                    <td className="px-5 py-2 text-center">✓</td>
                    <td className="px-5 py-2">
                      <span className="line-through">{rel.taskName}</span>
                      {task.completedAt && (
                        <span className="ml-2 text-[10px]">
                          завершена {formatFull(task.completedAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 tabular-nums">
                      {formatFull(rel.qaEndDate)}
                    </td>
                    <td className="px-5 py-2 tabular-nums">
                      {formatRelease(rel.releaseDate)}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {!readOnly && (
                        <span className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => markActive(rel.taskId)}
                            title="Снять отметку о завершении: задача снова участвует в планировании"
                            className="text-xs text-slate-400 hover:text-primary"
                          >
                            ↩ вернуть в работу
                          </button>
                          <button
                            onClick={() => deleteTask(rel.taskId)}
                            className="text-xs text-slate-400 hover:text-rose-600"
                          >
                            удалить
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>

      {showForm && (
        <TaskForm
          employees={viewData.employees}
          defaultPriority={nextPriority}
          onAdd={addTask}
          onClose={() => setShowForm(false)}
        />
      )}

      {showUrgent && (
        <UrgentTaskModal
          data={viewData}
          onApply={(urgent) => {
            pushUndo();
            addTask(urgent);
            setShowUrgent(false);
          }}
          onClose={() => setShowUrgent(false)}
        />
      )}

      {editingTask && (
        <TaskForm
          employees={viewData.employees}
          defaultPriority={editingTask.priority}
          initialTask={editingTask}
          onAdd={updateTask}
          onClose={() => setEditingTask(null)}
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
    </div>
  );
}

// Переключатель команд: пилюли-вкладки. В режиме просмотра (без onAdd) с одной
// командой не показываем — переключать нечего.
function TeamTabs({
  teams,
  activeId,
  onSelect,
  onAdd,
}: {
  teams: Team[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
}) {
  if (teams.length <= 1 && !onAdd) return null;
  return (
    <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
      {teams.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`rounded-full px-3 py-1 text-sm ${
            t.id === activeId
              ? 'bg-white font-medium text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.name}
        </button>
      ))}
      {onAdd && (
        <button
          onClick={onAdd}
          title="Добавить команду"
          className="rounded-full px-2 py-1 text-sm text-slate-400 hover:text-primary"
        >
          +
        </button>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
