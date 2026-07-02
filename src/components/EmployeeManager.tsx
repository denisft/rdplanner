import { useState } from 'react';
import type { Employee, Specialization, StageType } from '../types';
import { SPECIALIZATION_LABELS, SPECIALIZATION_ORDER, STAGE_LABELS } from '../types';
import { GRANTABLE_EXTRA_STAGES } from '../roles';
import { shortLabel } from '../engine/dates';

interface Props {
  employees: Employee[];
  onAdd: (name: string, specialization: Specialization) => void;
  onUpdate: (id: string, patch: Partial<Employee>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function EmployeeManager({
  employees,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: Props) {
  const [newName, setNewName] = useState('');
  const [newSpec, setNewSpec] = useState<Specialization>('backend');

  const grouped = SPECIALIZATION_ORDER.map((spec) => ({
    spec,
    list: employees.filter((e) => e.specialization === spec),
  }));

  const addNew = () => {
    if (!newName.trim()) return;
    onAdd(newName.trim(), newSpec);
    setNewName('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            Команда · {employees.length} чел.
          </h2>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Закрыть
          </button>
        </div>

        {/* Добавление нового сотрудника */}
        <div className="mb-4 flex items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-500">Новый сотрудник</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNew()}
              placeholder="Имя Фамилия"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 outline-none focus:border-sky-500"
            />
          </label>
          <select
            value={newSpec}
            onChange={(e) => setNewSpec(e.target.value as Specialization)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {SPECIALIZATION_ORDER.map((s) => (
              <option key={s} value={s}>
                {SPECIALIZATION_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            onClick={addNew}
            disabled={!newName.trim()}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40"
          >
            Добавить
          </button>
        </div>

        {/* Список по специализациям */}
        <div className="space-y-4">
          {grouped.map(({ spec, list }) => (
            <div key={spec}>
              <div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {SPECIALIZATION_LABELS[spec]} · {list.length}
              </div>
              {list.length === 0 && (
                <div className="px-1 py-2 text-sm text-slate-400">
                  Пока никого
                </div>
              )}
              <div className="space-y-2">
                {list.map((emp) => (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmployeeRow({
  emp,
  onUpdate,
  onDelete,
}: {
  emp: Employee;
  onUpdate: (id: string, patch: Partial<Employee>) => void;
  onDelete: (id: string) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const addRange = () => {
    if (!from || !to) return;
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    onUpdate(emp.id, { unavailable: [...emp.unavailable, { from: lo, to: hi }] });
    setFrom('');
    setTo('');
  };

  const removeRange = (idx: number) =>
    onUpdate(emp.id, {
      unavailable: emp.unavailable.filter((_, i) => i !== idx),
    });

  const toggleExtraStage = (type: StageType, on: boolean) => {
    const current = emp.extraStages ?? [];
    const next = on
      ? [...current, type]
      : current.filter((t) => t !== type);
    onUpdate(emp.id, { extraStages: next });
  };

  // Доп-этапы предлагаем только разработчикам: у лида они и так есть по базе,
  // у QA — отдельный трек.
  const showExtraStages =
    emp.specialization === 'backend' || emp.specialization === 'frontend';

  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="flex items-center gap-2">
        <input
          value={emp.name}
          onChange={(e) => onUpdate(emp.id, { name: e.target.value })}
          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
        <select
          value={emp.specialization}
          onChange={(e) =>
            onUpdate(emp.id, {
              specialization: e.target.value as Specialization,
            })
          }
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {SPECIALIZATION_ORDER.map((s) => (
            <option key={s} value={s}>
              {SPECIALIZATION_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (confirm(`Удалить «${emp.name}» из команды?`)) onDelete(emp.id);
          }}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          удалить
        </button>
      </div>

      {/* Доп-этапы сверх специализации (для опытных разработчиков) */}
      {showExtraStages && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400">Также может:</span>
          {GRANTABLE_EXTRA_STAGES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-1 text-xs text-slate-600"
            >
              <input
                type="checkbox"
                checked={emp.extraStages?.includes(type) ?? false}
                onChange={(e) => toggleExtraStage(type, e.target.checked)}
              />
              {STAGE_LABELS[type]}
            </label>
          ))}
        </div>
      )}

      {/* Недоступность / отпуска */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Недоступен:</span>
        {emp.unavailable.length === 0 && (
          <span className="text-xs text-slate-300">нет</span>
        )}
        {emp.unavailable.map((r, idx) => (
          <span
            key={idx}
            className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800"
          >
            {shortLabel(r.from)} – {shortLabel(r.to)}
            <button
              onClick={() => removeRange(idx)}
              className="text-amber-500 hover:text-amber-700"
              title="Убрать"
            >
              ×
            </button>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
          />
          <button
            onClick={addRange}
            disabled={!from || !to}
            className="rounded bg-slate-200 px-2 py-0.5 text-xs hover:bg-slate-300 disabled:opacity-40"
          >
            + отпуск
          </button>
        </span>
      </div>
    </div>
  );
}
