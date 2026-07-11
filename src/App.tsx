import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Employee, Specialization, Task } from './types';
import { schedule } from './engine/scheduler';
import { completeTask, reopenTask } from './engine/complete';
import { formatISO, parseISO, SHORT_MONTHS, SHORT_WEEKDAYS } from './engine/dates';
import { GanttChart } from './components/GanttChart';
import { TaskForm } from './components/TaskForm';
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

function loadShowReleases(): boolean {
  try {
    return localStorage.getItem(SHOW_RELEASES_KEY) !== '0';
  } catch {
    return true;
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

  // Загрузка опубликованного плана при открытии по ссылке.
  useEffect(() => {
    if (!sharedId) return;
    fetchSharedPlan(sharedId)
      .then((d) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [sharedId]);

  // Reflow: расписание пересчитывается при любом изменении данных.
  const result = useMemo(() => schedule(data), [data]);

  // Автосохранение в localStorage (только в своём режиме редактирования).
  useEffect(() => {
    if (!readOnly) autosave(data);
  }, [data, readOnly]);

  const visibleDays = data.horizonWeeks * 5;

  // Счётчик в шапке: завершённые не смешиваем с задачами в работе.
  const activeTaskCount = data.tasks.filter((t) => !t.done).length;
  const doneTaskCount = data.tasks.length - activeTaskCount;
  const taskCountLabel =
    `${data.employees.length} чел · ${activeTaskCount} задач` +
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
    const completedAt = new Map(data.tasks.map((t) => [t.id, t.completedAt ?? '']));
    return releasesSorted
      .filter((r) => r.done)
      .sort((a, b) =>
        (completedAt.get(b.taskId) ?? '').localeCompare(
          completedAt.get(a.taskId) ?? '',
        ),
      );
  }, [releasesSorted, data.tasks]);

  // Последний видимый день горизонта — для пометки «за горизонтом».
  const lastVisibleDate = result.days[visibleDays - 1] ?? null;

  const nextPriority = useMemo(() => {
    const min = data.tasks.reduce((m, t) => Math.min(m, t.priority), 3);
    return Math.max(1, min);
  }, [data.tasks]);

  const addTask = (task: Task) =>
    setData((d) => ({ ...d, tasks: [...d.tasks, task] }));

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
      if (showForm || editingTask || showTeam || showReport) return;
      setGanttFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ganttFull, showForm, editingTask, showTeam, showReport]);

  // Перетащили этап на сотрудника и день — закрепляем вручную.
  const moveStage = (stageId: string, employeeId: string, isoDate: string) => {
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
      data.tasks.reduce(
        (n, t) =>
          t.done ? n : n + t.stages.filter((s) => s.pinnedStartDate).length,
        0,
      ),
    [data.tasks],
  );

  // Снять все ручные закрепления — страховка, если запутался в перетаскиваниях.
  const resetPins = () => {
    pushUndo();
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.done
          ? t
          : {
              ...t,
              stages: t.stages.map((s) => ({ ...s, pinnedStartDate: null })),
            },
      ),
    }));
  };

  // --- Управление командой ---
  const addEmployee = (name: string, specialization: Specialization) =>
    setData((d) => ({
      ...d,
      employees: [
        ...d.employees,
        { id: newId(), name, specialization, unavailable: [] },
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
    sharingRef.current = true;
    setSharing(true);
    setStatus(null);
    try {
      const id = await publishPlan(data);
      const url = shareUrl(id);
      setShareLink(url);
      try {
        await navigator.clipboard?.writeText(url);
        setStatus({ text: 'Ссылка скопирована — отправьте коллегам', kind: 'ok' });
      } catch {
        setStatus({ text: 'Ссылка готова — скопируйте её ниже', kind: 'ok' });
      }
    } catch {
      setShareLink('');
      setStatus({
        text: 'Не удалось опубликовать. Подключено ли хранилище в Vercel?',
        kind: 'error',
      });
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  const noop = () => {};

  // Гант один и тот же в обычном виде и в фокус-режиме — меняется только обёртка.
  const ganttEl = (
    <GanttChart
      data={data}
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
              onClick={() => downloadMarkdown(data, result)}
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
                      downloadMarkdown(data, result);
                      setStatus({ text: 'Выгружено в team-plan.md', kind: 'ok' });
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    title="Скачать план таблицей в markdown (.md)"
                  >
                    Экспорт .md
                  </button>

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
            обновляйте кнопкой «Поделиться» — ссылка не меняется
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
          Alt+двойной клик по блоку — редактировать задачу. Ctrl+Z —
          отменить последнее действие.
        </span>
      </div>

      {/* Релизы */}
      <section className="overflow-hidden rounded-xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">
            Задачи и даты релизов
          </h2>
          <button
            onClick={() => downloadReleasesCsv(activeReleases, data.tasks)}
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
              const task = data.tasks.find((t) => t.id === rel.taskId)!;
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
                const task = data.tasks.find((t) => t.id === rel.taskId)!;
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
          employees={data.employees}
          defaultPriority={nextPriority}
          onAdd={addTask}
          onClose={() => setShowForm(false)}
        />
      )}

      {editingTask && (
        <TaskForm
          employees={data.employees}
          defaultPriority={editingTask.priority}
          initialTask={editingTask}
          onAdd={updateTask}
          onClose={() => setEditingTask(null)}
        />
      )}

      {showReport && (
        <ReportModal data={data} result={result} onClose={() => setShowReport(false)} />
      )}

      {showTeam && (
        <EmployeeManager
          employees={data.employees}
          onAdd={addEmployee}
          onUpdate={updateEmployee}
          onDelete={deleteEmployee}
          onClose={() => setShowTeam(false)}
        />
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
