// Модалка «Срочная задача» (БЛ-17): форма срочной задачи + живой отчёт
// «кого задело». Всё считается на копии данных (urgentImpact), рабочий план
// не меняется до «Применить»; «Отмена» закрывает без следов.

import { useMemo, useState } from 'react';
import type { AppData, StageType, Task } from '../types';
import { STAGE_LABELS, STAGE_ORDER } from '../types';
import { assigneePool } from '../roles';
import { urgentImpact, type ImpactRow } from '../engine/urgentImpact';
import {
  formatISO,
  nextWorkingDay,
  parseISO,
  SHORT_MONTHS,
  SHORT_WEEKDAYS,
} from '../engine/dates';
import {
  buildStages,
  defaultDrafts,
  reviewLockedTo as lockedReviewer,
  uid,
  type StageDraft,
} from './stageDraft';

interface Props {
  /** Рабочий план — только для расчёта и пула исполнителей, не мутируется. */
  data: AppData;
  /** «Применить»: App делает pushUndo() + addTask(urgent). */
  onApply: (urgent: Task) => void;
  onClose: () => void;
}

/** Дата релиза с днём недели, напр. "18 июн, чт". */
function formatRelease(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${SHORT_WEEKDAYS[d.getDay()]}`;
}

export function UrgentTaskModal({ data, onApply, onClose }: Props) {
  const [name, setName] = useState('');
  // Дефолт — сегодня; выходной нормализуется к рабочему дню при сборке.
  const [startDate, setStartDate] = useState(() => formatISO(new Date()));
  const [stages, setStages] = useState<Record<StageType, StageDraft>>(() =>
    defaultDrafts(true),
  );
  // Стабильный id: задача пересобирается на каждый ввод, но остаётся «той же».
  const [urgentId] = useState(uid);

  const update = (type: StageType, patch: Partial<StageDraft>) =>
    setStages((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));

  const reviewLockedTo = lockedReviewer(stages);

  // Срочная задача из текущего состояния формы: приоритет 0 (высший),
  // первый включённый этап закрепляется на дате старта — «начинаем такого-то
  // числа»; остальные этапы движок выстроит следом, обтекая занятость.
  const urgent = useMemo<Task>(() => {
    const built = buildStages(stages);
    const pin = startDate
      ? formatISO(nextWorkingDay(parseISO(startDate)))
      : null;
    if (built.length > 0 && pin) {
      built[0] = { ...built[0], pinnedStartDate: pin };
    }
    return {
      id: urgentId,
      name: name.trim() || 'Срочная задача',
      priority: 0,
      stages: built,
    };
  }, [name, startDate, stages, urgentId]);

  // Живой предпросмотр: два прогона движка на каждый ввод — дёшево,
  // как основной useMemo(schedule) в App.
  const impact = useMemo(() => urgentImpact(data, urgent), [data, urgent]);

  const hasStages = urgent.stages.length > 0;
  const canApply = name.trim().length > 0 && hasStages;

  // Подпись «чем занят человек»: какие этапы срочной пришлись на исполнителей
  // затронутой задачи. Пусто — задело по цепочке (через сдвиг других задач).
  const busyLabel = (row: ImpactRow): string | null => {
    const task = data.tasks.find((t) => t.id === row.taskId);
    if (!task) return null;
    const taskAssignees = new Set(
      task.stages.map((s) => s.assigneeId).filter((id) => id !== null),
    );
    const byEmployee = new Map<string, string[]>();
    for (const s of urgent.stages) {
      if (!s.assigneeId || !taskAssignees.has(s.assigneeId)) continue;
      const list = byEmployee.get(s.assigneeId) ?? [];
      list.push(STAGE_LABELS[s.type]);
      byEmployee.set(s.assigneeId, list);
    }
    if (byEmployee.size === 0) return 'задело по цепочке';
    // Без глаголов с родом («занят/занята») — имена бывают любые.
    const parts = [...byEmployee].map(([empId, labels]) => {
      const empName = data.employees.find((e) => e.id === empId)?.name ?? '—';
      return `${empName} — ${labels.join(' + ')}`;
    });
    return `срочная занимает: ${parts.join('; ')}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-error-light text-error"
          >
            ⚡
          </span>
          <h2 className="text-lg font-semibold text-slate-800">
            Срочная задача
          </h2>
          <button
            onClick={onClose}
            title="Закрыть"
            className="ml-auto rounded-full px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 flex items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-500">Название</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. Хотфикс оплаты"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 outline-none focus:border-primary"
            />
          </label>
          <span
            className="mb-0.5 shrink-0 rounded-full border border-error/30 bg-error-light px-3 py-1 text-xs font-medium text-rose-600"
            title="Срочная задача всегда с высшим приоритетом — при конфликте за человека она встаёт первой"
          >
            приоритет 0
          </span>
        </div>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-500">
            Старт — первый этап закрепляется на этой дате
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-44 rounded-md border border-slate-300 px-2 py-1.5 outline-none focus:border-primary"
          />
        </label>

        <div className="space-y-2">
          {STAGE_ORDER.map((type) => {
            const d = stages[type];
            const isReview = type === 'review';
            const locked = isReview && reviewLockedTo !== null;
            const options = assigneePool(type, data.employees);
            return (
              <div
                key={type}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              >
                <label className="flex w-32 shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={(e) => update(type, { enabled: e.target.checked })}
                  />
                  <span className="text-slate-700">{STAGE_LABELS[type]}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={d.durationDays}
                  disabled={!d.enabled}
                  onChange={(e) =>
                    update(type, { durationDays: Number(e.target.value) || 1 })
                  }
                  className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                  title="Длительность в днях"
                />
                <span className="text-slate-400">дн.</span>
                <select
                  value={(locked ? reviewLockedTo : d.assigneeId) ?? ''}
                  disabled={!d.enabled || locked}
                  onChange={(e) =>
                    update(type, { assigneeId: e.target.value || null })
                  }
                  className="ml-auto w-44 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                >
                  <option value="">— исполнитель —</option>
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
        <p className="mt-2 text-xs text-slate-400">
          Ревью кода автоматически назначается на лида, выбранного для
          архитектуры.
        </p>

        {/* Отчёт «кого задело» — живой предпросмотр на копии плана. */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-700">Кого задело</span>
            {hasStages &&
              (impact.rows.length > 0 ? (
                <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {impact.rows.length}{' '}
                  {impact.rows.length === 1
                    ? 'задача сдвинется'
                    : impact.rows.length < 5
                      ? 'задачи сдвинутся'
                      : 'задач сдвинутся'}
                </span>
              ) : (
                <span className="rounded-full bg-success-light px-2.5 py-0.5 text-xs font-medium text-teal-700">
                  никого не задело
                </span>
              ))}
            {hasStages && impact.urgentRelease && (
              <span className="ml-auto text-xs text-slate-500">
                Релиз срочной:{' '}
                <span className="font-medium tabular-nums text-slate-700">
                  {formatRelease(impact.urgentRelease)}
                </span>
              </span>
            )}
          </div>

          {hasStages && impact.urgentUnplaced && (
            <div className="mb-2 rounded-lg border border-warning/40 bg-warning-light px-2.5 py-1.5 text-xs text-amber-700">
              Срочная задача не влезает в расчётный горизонт — движок разместит
              её по мере освобождения людей.
            </div>
          )}

          {!hasStages && (
            <p className="text-xs text-slate-400">
              Включите хотя бы один этап, чтобы увидеть влияние на план.
            </p>
          )}

          <div className="space-y-1.5">
            {impact.rows.map((row) => (
              <div
                key={row.taskId}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {row.taskName}
                  </span>
                  <span className="rounded-full bg-warning-light px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    уедет вправо
                  </span>
                  <span className="font-semibold tabular-nums text-rose-600">
                    +{row.shiftDays} дн
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {busyLabel(row)} · релиз{' '}
                  <span className="tabular-nums">
                    {formatRelease(row.releaseBefore)}
                  </span>{' '}
                  →{' '}
                  <span className="font-medium tabular-nums text-slate-700">
                    {formatRelease(row.releaseAfter)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <span className="text-xs text-slate-400">
            Рабочий план не тронут — изменения только после «Применить»
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-full px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Отмена
          </button>
          <button
            onClick={() => onApply(urgent)}
            disabled={!canApply}
            title="Внести срочную задачу в план — один Ctrl+Z откатит целиком"
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40"
          >
            Применить · 1× Ctrl+Z
          </button>
        </div>
      </div>
    </div>
  );
}
