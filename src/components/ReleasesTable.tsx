// Таблица «Задачи и релизы». Связана с гантом: наведение на строку
// подсвечивает этапы задачи на ганте (и наоборот), клик открывает задачу.
// Редкие действия (завершить, удалить) — в меню «⋯» строки.

import { useState, type Ref } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  MoreHorizontal,
  PencilLine,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Employee, Task } from '../types';
import { STAGE_LABELS } from '../types';
import type { TaskRelease } from '../engine/scheduler';
import { formatRelease, formatShort, matchesQuery } from './format';
import { avatarColor, initials, PRIORITY_STYLE, STAGE_DOT } from './stageStyle';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu';
import { Tip } from '../ui/Tooltip';

interface Props {
  activeReleases: TaskRelease[];
  doneReleases: TaskRelease[];
  tasks: Task[];
  employees: Employee[];
  /** Последний видимый день горизонта — для пометки «за горизонтом». */
  lastVisibleDate: string | null;
  readOnly: boolean;
  highlightTaskId: string | null;
  /** Задача, открытая в боковой панели: строка выделена. */
  selectedTaskId: string | null;
  /** Релизы до правки в боковой панели: у сдвинувшихся строк — «было …». */
  releasesBefore: Map<string, string | null> | null;
  query: string;
  onQueryChange: (q: string) => void;
  searchRef: Ref<HTMLInputElement>;
  onHoverTask: (taskId: string | null) => void;
  onOpenTask: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: number) => void;
  onComplete: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onExportCsv: () => void;
}

export function ReleasesTable({
  activeReleases,
  doneReleases,
  tasks,
  employees,
  lastVisibleDate,
  readOnly,
  highlightTaskId,
  selectedTaskId,
  releasesBefore,
  query,
  onQueryChange,
  searchRef,
  onHoverTask,
  onOpenTask,
  onSetPriority,
  onComplete,
  onReopen,
  onDelete,
  onExportCsv,
}: Props) {
  // Секция «Завершённые»: свёрнута по умолчанию.
  const [showDone, setShowDone] = useState(false);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const empById = new Map(employees.map((e) => [e.id, e]));

  const visible = activeReleases.filter((r) => {
    const t = taskById.get(r.taskId);
    return t && matchesQuery(t, employees, query);
  });

  const th = 'px-3.5 py-2.5 text-left text-[11.5px] font-bold tracking-[0.06em] whitespace-nowrap text-faint uppercase';
  const td = 'px-3.5 py-2 align-middle';

  return (
    <section className="min-w-0 rounded-[14px] border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3.5 py-2.5">
        <h2 className="flex items-baseline gap-2.5 text-[15px] font-extrabold tracking-tight">
          Задачи и релизы
          <small className="text-[12.5px] font-semibold text-faint">
            {activeReleases.length} в работе
          </small>
        </h2>
        <div className="flex-1" />
        <label className="relative flex items-center">
          <Search size={15} className="pointer-events-none absolute left-2.5 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Задача или человек"
            aria-label="Поиск по задачам и людям"
            className="h-8 w-[240px] max-w-[55vw] rounded-[10px] border border-line bg-surface-2 pr-2.5 pl-8 text-sm outline-none placeholder:text-faint focus:border-primary focus:bg-surface"
          />
        </label>
        <Tip label="Скачать таблицу как CSV для Excel; завершённые не выгружаются">
          <Button size="sm" onClick={onExportCsv} disabled={activeReleases.length === 0}>
            <Download size={14} />
            CSV
          </Button>
        </Tip>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Приоритет</th>
              <th className={th}>Задача</th>
              <th className={th}>Кто занят</th>
              <th className={th}>QA готово</th>
              <th className={th}>Релиз · вт/чт</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody onMouseLeave={() => onHoverTask(null)}>
            {visible.map((rel) => {
              const task = taskById.get(rel.taskId)!;
              const beyond =
                rel.releaseDate !== null &&
                lastVisibleDate !== null &&
                rel.releaseDate > lastVisibleDate;
              const before = releasesBefore?.get(rel.taskId);
              const moved =
                releasesBefore !== null &&
                before !== undefined &&
                before !== rel.releaseDate &&
                rel.taskId !== selectedTaskId;
              const people = [...new Set(task.stages.map((s) => s.assigneeId))];
              const totalDays = task.stages.reduce((n, s) => n + s.durationDays, 0) || 1;
              return (
                <tr
                  key={rel.taskId}
                  tabIndex={readOnly ? undefined : 0}
                  onMouseEnter={() => onHoverTask(rel.taskId)}
                  onClick={() => !readOnly && onOpenTask(rel.taskId)}
                  onKeyDown={(e) => {
                    if (!readOnly && e.key === 'Enter' && e.target === e.currentTarget)
                      onOpenTask(rel.taskId);
                  }}
                  className={`group border-b border-line-soft outline-none focus-visible:bg-hover ${
                    readOnly ? '' : 'cursor-pointer'
                  } ${
                    selectedTaskId === rel.taskId
                      ? 'bg-primary-light'
                      : highlightTaskId === rel.taskId
                        ? 'bg-hover'
                        : 'hover:bg-hover'
                  }`}
                >
                  <td className={td}>
                    <input
                      type="number"
                      min={1}
                      value={task.priority}
                      disabled={readOnly}
                      aria-label="Приоритет: меньше число — выше"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onSetPriority(task.id, Number(e.target.value) || 1)}
                      className={`h-6 w-12 rounded-[7px] border text-center text-[12.5px] font-extrabold tabular-nums outline-none focus:ring-2 focus:ring-primary disabled:opacity-100 ${PRIORITY_STYLE(
                        task.priority,
                      )}`}
                    />
                  </td>
                  <td className={td}>
                    <div className="font-bold">{rel.taskName}</div>
                    <div className="mt-[5px] flex h-[5px] w-[120px] gap-0.5">
                      {task.stages.map((s) => (
                        <i
                          key={s.id}
                          title={`${STAGE_LABELS[s.type]} · ${s.durationDays} дн.`}
                          className={`block rounded-[2px] ${STAGE_DOT[s.type]}`}
                          style={{ flex: s.durationDays / totalDays }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex">
                      {people.map((id, i) => {
                        const emp = id ? empById.get(id) : undefined;
                        return (
                          <span
                            key={id ?? `none-${i}`}
                            title={emp ? emp.name : 'Без исполнителя'}
                            style={emp ? { background: avatarColor(emp.id) } : undefined}
                            className={`-ml-1.5 grid h-[26px] w-[26px] place-items-center rounded-full border-2 text-[10.5px] font-extrabold first:ml-0 ${
                              emp
                                ? 'border-surface text-white'
                                : 'border-dashed border-faint bg-surface-2 text-faint'
                            }`}
                          >
                            {emp ? initials(emp.name) : '?'}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className={`${td} text-muted tabular-nums`}>{formatShort(rel.qaEndDate)}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="font-bold tabular-nums">{formatRelease(rel.releaseDate)}</span>
                    {moved ? (
                      <span className="ml-2 rounded-full bg-warning-light px-2 py-0.5 text-[11px] font-bold text-warning-ink">
                        было {formatShort(before ?? null)}
                      </span>
                    ) : (
                      beyond && (
                        <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">
                          за горизонтом
                        </span>
                      )
                    )}
                  </td>
                  <td className={`${td} w-12 text-right`} onClick={(e) => e.stopPropagation()}>
                    {!readOnly && (
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton
                            label="Действия с задачей"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal size={16} />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem
                            icon={<PencilLine size={16} />}
                            shortcut="Enter"
                            onSelect={() => onOpenTask(rel.taskId)}
                          >
                            Открыть задачу
                          </MenuItem>
                          <MenuItem icon={<Check size={16} />} onSelect={() => onComplete(rel.taskId)}>
                            Завершить
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => onDelete(rel.taskId)}>
                            Удалить задачу
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3.5 py-7 text-center text-muted">
                  {query.trim()
                    ? `Ничего не нашлось по запросу «${query.trim()}»`
                    : readOnly
                      ? 'Задач нет'
                      : 'Задач пока нет. Нажмите «Задача» или клавишу N.'}
                </td>
              </tr>
            )}
          </tbody>

          {/* Завершённые: свёрнутая секция-архив в конце таблицы. */}
          {doneReleases.length > 0 && (
            <tbody>
              <tr className="bg-surface-2">
                <td colSpan={6} className="px-2.5 py-1.5">
                  <button
                    onClick={() => setShowDone((v) => !v)}
                    aria-expanded={showDone}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-bold text-muted hover:bg-hover"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${showDone ? '' : '-rotate-90'}`}
                    />
                    Завершённые · {doneReleases.length}
                  </button>
                </td>
              </tr>
              {showDone &&
                doneReleases.map((rel) => {
                  const task = taskById.get(rel.taskId)!;
                  return (
                    <tr key={rel.taskId} className="border-b border-line-soft text-faint">
                      <td className={`${td} pl-7`}>
                        <Check size={14} />
                      </td>
                      <td className={td}>
                        <span className="line-through">{rel.taskName}</span>
                        {task.completedAt && (
                          <span className="ml-2 text-[11px]">
                            завершена {formatShort(task.completedAt)}
                          </span>
                        )}
                      </td>
                      <td className={td} />
                      <td className={`${td} tabular-nums`}>{formatShort(rel.qaEndDate)}</td>
                      <td className={`${td} tabular-nums`}>{formatRelease(rel.releaseDate)}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {!readOnly && (
                          <span className="inline-flex gap-1">
                            <Tip label="Снять отметку о завершении: задача снова участвует в планировании">
                              <Button size="sm" variant="ghost" onClick={() => onReopen(rel.taskId)}>
                                <RotateCcw size={14} />
                                Вернуть
                              </Button>
                            </Tip>
                            <IconButton label="Удалить задачу" size="sm" onClick={() => onDelete(rel.taskId)}>
                              <Trash2 size={14} />
                            </IconButton>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}
