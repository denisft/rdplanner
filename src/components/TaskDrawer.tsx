// Боковая панель задачи: создание, правка и срочная задача (БЛ-17) в одном
// месте. Гант остаётся на виду и пересчитывается на лету: панель отдаёт
// черновик задачи наверх (onDraftChange), App считает по нему расписание
// и возвращает сюда «как это скажется на других». Рабочий план не меняется
// до «Сохранить» — отмена закрывает панель без следов.

import * as RD from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Minus, Plus, Trash2, X, Zap } from 'lucide-react';
import type { Employee, StageType, Task } from '../types';
import { STAGE_LABELS, STAGE_ORDER } from '../types';
import { assigneePool } from '../roles';
import type { ImpactRow } from '../engine/urgentImpact';
import { formatISO, nextWorkingDay, parseISO } from '../engine/dates';
import {
  buildStages,
  defaultDrafts,
  draftsFromTask,
  reviewLockedTo as lockedReviewer,
  uid,
  type StageDraft,
} from './stageDraft';
import { STAGE_DOT } from './stageStyle';
import { formatRelease, formatShort } from './format';
import { Button, IconButton, Kbd } from '../ui/Button';

export type DrawerMode = 'new' | 'edit' | 'urgent';

/** Что панель показывает внизу: релиз задачи и кого задело. */
export interface DrawerImpact {
  release: string | null;
  /** Релиз этой задачи до правки (только для редактирования). */
  releaseBefore: string | null;
  /** Задача не влезла в расчётный горизонт. */
  unplaced: boolean;
  rows: ImpactRow[];
}

interface Props {
  mode: DrawerMode;
  /** Редактируемая задача (mode = 'edit'). */
  initialTask?: Task;
  defaultPriority: number;
  employees: Employee[];
  impact: DrawerImpact | null;
  /** Черновик из текущего состояния формы — для живого предпросмотра. */
  onDraftChange: (task: Task) => void;
  onSave: (task: Task) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const MAX_DAYS = 60;

export function TaskDrawer({
  mode,
  initialTask,
  defaultPriority,
  employees,
  impact,
  onDraftChange,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const isEdit = mode === 'edit';
  const isUrgent = mode === 'urgent';

  const [name, setName] = useState(initialTask?.name ?? '');
  const [priority, setPriority] = useState(initialTask?.priority ?? defaultPriority);
  // Срочная: дата старта — первый этап закрепляется на ней. Дефолт — сегодня;
  // выходной нормализуется к рабочему дню при сборке.
  const [startDate, setStartDate] = useState(() => formatISO(new Date()));
  const [stages, setStages] = useState<Record<StageType, StageDraft>>(() =>
    initialTask ? draftsFromTask(initialTask) : defaultDrafts(true),
  );
  const [showErrors, setShowErrors] = useState(false);
  // Стабильный id: черновик пересобирается на каждый ввод, но остаётся «той же» задачей.
  const [draftId] = useState(() => initialTask?.id ?? uid());

  const update = (type: StageType, patch: Partial<StageDraft>) =>
    setStages((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));

  const reviewLockedTo = lockedReviewer(stages);

  const draft = useMemo<Task>(() => {
    const built = buildStages(stages, initialTask);
    if (isUrgent && built.length > 0 && startDate) {
      built[0] = {
        ...built[0],
        pinnedStartDate: formatISO(nextWorkingDay(parseISO(startDate))),
      };
    }
    // Спред первым: у завершённой задачи сохраняются done/completedAt.
    return {
      ...initialTask,
      id: draftId,
      name: name.trim() || (isUrgent ? 'Срочная задача' : 'Новая задача'),
      priority: isUrgent ? 0 : priority,
      stages: built,
    };
  }, [stages, initialTask, isUrgent, startDate, draftId, name, priority]);

  useEffect(() => onDraftChange(draft), [draft, onDraftChange]);

  const hasStages = draft.stages.length > 0;
  const nameMissing = name.trim().length === 0;

  const save = () => {
    if (nameMissing || !hasStages) {
      setShowErrors(true);
      return;
    }
    onSave({ ...draft, name: name.trim() });
  };

  const title = isEdit ? 'Задача' : isUrgent ? 'Срочная задача' : 'Новая задача';

  return (
    <RD.Root open onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        {/* Подложка прозрачная: гант за панелью остаётся виден и меняется
            вместе с формой. Клик мимо панель не закрывает — правки не теряются. */}
        <RD.Overlay className="fixed inset-0 z-[70]" />
        <RD.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
          className="fixed inset-y-0 right-0 z-[70] flex w-[min(440px,100vw)] animate-drawer flex-col border-l border-line bg-surface text-ink shadow-pop outline-none"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
            {isUrgent && (
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-warning-light text-warning-ink">
                <Zap size={16} />
              </span>
            )}
            <RD.Title className="min-w-0 flex-1 text-base font-bold tracking-tight">
              {title}
              {initialTask?.done && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs font-semibold text-muted">
                  <Check size={12} /> завершена
                </span>
              )}
            </RD.Title>
            <RD.Close asChild>
              <IconButton label="Закрыть без сохранения" shortcut="Esc">
                <X size={18} />
              </IconButton>
            </RD.Close>
          </div>

          <div className="grid min-h-0 flex-1 content-start gap-[18px] overflow-y-auto p-4">
            {isUrgent && (
              <div className="flex items-start gap-2 rounded-[10px] bg-warning-light px-3 py-2.5 text-[13px] font-semibold text-warning-ink">
                <Zap size={16} className="mt-px shrink-0" />
                <span>
                  Срочная встаёт впереди всех по приоритету. Внизу видно, чьи
                  релизы из-за неё уедут, — план не изменится, пока вы не
                  нажмёте «Внести в план».
                </span>
              </div>
            )}

            <Field label="Название" htmlFor="task-name">
              <input
                id="task-name"
                autoFocus={!isEdit}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isUrgent ? 'Например, хотфикс оплаты' : 'Например, платёжный шлюз v2'}
                autoComplete="off"
                className="h-[38px] rounded-[10px] border border-line bg-surface px-3 outline-none focus:border-primary focus:ring-3 focus:ring-primary-light"
              />
              {showErrors && nameMissing && (
                <span className="text-xs font-semibold text-error-ink">
                  Без названия задачу не сохранить
                </span>
              )}
            </Field>

            {isUrgent ? (
              <Field label="Старт — первый этап закрепится на этой дате" htmlFor="task-start">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="task-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-[34px] rounded-[10px] border border-line bg-surface px-2.5 outline-none focus:border-primary"
                  />
                  <span className="rounded-full bg-danger px-2.5 py-1 text-xs font-bold text-white">
                    приоритет 0
                  </span>
                </div>
              </Field>
            ) : (
              <Field label="Приоритет">
                <div className="flex items-center gap-3">
                  <Stepper
                    value={priority}
                    min={0}
                    max={99}
                    label="Приоритет"
                    onChange={setPriority}
                  />
                  <p className="m-0 text-xs text-faint">
                    Меньше число — выше. Решает, кому достаётся человек при
                    конфликте.
                  </p>
                </div>
              </Field>
            )}

            <Field label="Этапы — идут строго по порядку">
              <div className="grid gap-1.5">
                {STAGE_ORDER.map((type) => {
                  const d = stages[type];
                  const locked = type === 'review' && reviewLockedTo !== null;
                  const options = assigneePool(type, employees);
                  return (
                    <div
                      key={type}
                      className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1.5 rounded-xl border border-line p-2.5 ${
                        d.enabled ? 'bg-surface' : 'bg-surface-2'
                      }`}
                    >
                      <Switch
                        checked={d.enabled}
                        label={STAGE_LABELS[type]}
                        onChange={(on) => update(type, { enabled: on })}
                      />
                      <span
                        className={`flex items-center gap-2 font-bold ${d.enabled ? '' : 'opacity-45'}`}
                      >
                        <i className={`inline-block h-2.5 w-2.5 rounded-[3px] ${STAGE_DOT[type]}`} />
                        {STAGE_LABELS[type]}
                      </span>
                      <span className={d.enabled ? '' : 'opacity-45'}>
                        <Stepper
                          value={d.durationDays}
                          min={1}
                          max={MAX_DAYS}
                          suffix="дн."
                          label={`${STAGE_LABELS[type]}: длительность, рабочих дней`}
                          onChange={(v) => update(type, { durationDays: v, enabled: true })}
                        />
                      </span>
                      <select
                        value={(locked ? reviewLockedTo : d.assigneeId) ?? ''}
                        disabled={!d.enabled || locked}
                        aria-label={`${STAGE_LABELS[type]}: исполнитель`}
                        onChange={(e) => update(type, { assigneeId: e.target.value || null })}
                        className="col-span-2 col-start-2 h-8 rounded-[9px] border border-line bg-surface-2 px-2 text-[13px] font-semibold disabled:opacity-45"
                      >
                        <option value="">Без исполнителя</option>
                        {options.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="m-0 text-xs text-faint">
                Ревью кода автоматически назначается на лида, выбранного для архитектуры.
              </p>
              {showErrors && !hasStages && (
                <span className="text-xs font-semibold text-error-ink">
                  Включите хотя бы один этап
                </span>
              )}
            </Field>

            <ImpactCard impact={impact} hasStages={hasStages} isEdit={isEdit} />
          </div>

          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            {isEdit && onDelete && (
              <Button variant="ghost" className="text-error-ink" onClick={onDelete}>
                <Trash2 size={16} />
                Удалить
              </Button>
            )}
            <span className="hidden text-xs text-faint sm:inline">
              <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>
            </span>
            <div className="flex-1" />
            <RD.Close asChild>
              <Button>Отмена</Button>
            </RD.Close>
            <Button variant="primary" onClick={save}>
              {isEdit ? 'Сохранить' : isUrgent ? 'Внести в план' : 'Добавить'}
            </Button>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-xs font-bold text-muted">
          {label}
        </label>
      ) : (
        <span className="text-xs font-bold text-muted">{label}</span>
      )}
      {children}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  suffix,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  label: string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const btn =
    'grid h-7 w-7 cursor-pointer place-items-center bg-surface-2 text-muted hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40';
  return (
    <span className="inline-flex items-center overflow-hidden rounded-[9px] border border-line">
      <button
        type="button"
        aria-label="Меньше"
        className={btn}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        className="h-7 w-10 [appearance:textfield] bg-surface text-center font-bold tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="bg-surface pr-2 text-xs text-faint">{suffix}</span>}
      <button
        type="button"
        aria-label="Больше"
        className={btn}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      className="relative h-[18px] w-[30px] cursor-pointer appearance-none rounded-full bg-line transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] checked:bg-primary checked:after:translate-x-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    />
  );
}

function ImpactCard({
  impact,
  hasStages,
  isEdit,
}: {
  impact: DrawerImpact | null;
  hasStages: boolean;
  isEdit: boolean;
}) {
  if (!hasStages || !impact) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-faint">
        Включите хотя бы один этап, чтобы увидеть релиз и влияние на план.
      </div>
    );
  }
  const changed = isEdit && impact.releaseBefore !== null && impact.releaseBefore !== impact.release;
  const later = impact.rows.filter((r) => r.shiftDays > 0).length;
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-semibold text-muted">Релиз этой задачи</span>
        <b className="text-lg tracking-tight tabular-nums">{formatRelease(impact.release)}</b>
      </div>
      {changed && (
        <div className="-mt-1 text-right text-xs text-faint">
          было {formatRelease(impact.releaseBefore)}
        </div>
      )}
      {impact.unplaced && (
        <div className="flex items-start gap-2 rounded-lg bg-warning-light px-2.5 py-1.5 text-xs text-warning-ink">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          Задача не влезает в расчётный горизонт — движок разместит её по мере
          освобождения людей.
        </div>
      )}
      <div className="mt-1 flex items-center gap-2 text-xs font-bold text-muted">
        Как это скажется на других
        {impact.rows.length > 0 && (
          <span className="rounded-full bg-warning-light px-2 py-0.5 text-[11px] text-warning-ink">
            {later > 0 ? `сдвинется: ${later}` : `раньше: ${impact.rows.length}`}
          </span>
        )}
      </div>
      {impact.rows.length === 0 ? (
        <div className="text-[13px] text-faint">Ничьи релизы не сдвигаются</div>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {impact.rows.map((r) => (
            <li key={r.taskId} className="flex justify-between gap-2.5 text-[13px]">
              <span className="truncate">{r.taskName}</span>
              <span
                className={`font-bold whitespace-nowrap tabular-nums ${
                  r.shiftDays > 0 ? 'text-warning-ink' : 'text-success-ink'
                }`}
              >
                {formatShort(r.releaseBefore)} → {formatShort(r.releaseAfter)}
                <span className="ml-1.5 font-semibold opacity-75">
                  {r.shiftDays > 0 ? '+' : '−'}
                  {Math.abs(r.shiftDays)} дн
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
