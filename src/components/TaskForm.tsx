import { useState } from 'react';
import type { Employee, Stage, StageType, Task } from '../types';
import { STAGE_LABELS, STAGE_ORDER } from '../types';
import { assigneePool } from '../roles';

interface Props {
  employees: Employee[];
  defaultPriority: number;
  initialTask?: Task;
  onAdd: (task: Task) => void;
  onClose: () => void;
}

interface StageDraft {
  enabled: boolean;
  durationDays: number;
  assigneeId: string | null;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function draftsFromTask(task: Task): Record<StageType, StageDraft> {
  const defaults: Record<StageType, StageDraft> = {
    architecture: { enabled: false, durationDays: 2, assigneeId: null },
    development: { enabled: false, durationDays: 5, assigneeId: null },
    review: { enabled: false, durationDays: 1, assigneeId: null },
    qa: { enabled: false, durationDays: 2, assigneeId: null },
  };
  for (const stage of task.stages) {
    defaults[stage.type] = {
      enabled: true,
      durationDays: stage.durationDays,
      assigneeId: stage.assigneeId,
    };
  }
  return defaults;
}

export function TaskForm({ employees, defaultPriority, initialTask, onAdd, onClose }: Props) {
  const isEdit = initialTask !== undefined;

  const [name, setName] = useState(initialTask?.name ?? '');
  const [priority, setPriority] = useState(initialTask?.priority ?? defaultPriority);
  const [stages, setStages] = useState<Record<StageType, StageDraft>>(
    isEdit
      ? draftsFromTask(initialTask!)
      : {
          architecture: { enabled: true, durationDays: 2, assigneeId: null },
          development: { enabled: true, durationDays: 5, assigneeId: null },
          review: { enabled: true, durationDays: 1, assigneeId: null },
          qa: { enabled: true, durationDays: 2, assigneeId: null },
        },
  );

  const update = (type: StageType, patch: Partial<StageDraft>) =>
    setStages((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));

  const reviewLockedTo = stages.architecture.enabled
    ? stages.architecture.assigneeId
    : null;

  const canSubmit =
    name.trim().length > 0 &&
    STAGE_ORDER.some((t) => stages[t].enabled && stages[t].durationDays > 0);

  const submit = () => {
    const built: Stage[] = [];
    for (const type of STAGE_ORDER) {
      const d = stages[type];
      if (!d.enabled || d.durationDays <= 0) continue;
      const assigneeId =
        type === 'review' && reviewLockedTo !== null ? reviewLockedTo : d.assigneeId;

      // При редактировании сохраняем id этапа и pinnedStartDate, если этап уже существовал.
      const existingStage = initialTask?.stages.find((s) => s.type === type);
      built.push({
        id: existingStage?.id ?? uid(),
        type,
        durationDays: d.durationDays,
        assigneeId,
        pinnedStartDate: existingStage?.pinnedStartDate ?? null,
      });
    }
    // Спред первым: у завершённой задачи сохраняются done/completedAt.
    onAdd({
      ...initialTask,
      id: initialTask?.id ?? uid(),
      name: name.trim(),
      priority,
      stages: built,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-800">
          {isEdit ? 'Редактировать задачу' : 'Новая задача'}
        </h2>

        <div className="mb-4 flex gap-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-500">Название</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. Платёжный шлюз v2"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 outline-none focus:border-primary"
            />
          </label>
          <label className="w-28 text-sm">
            <span className="mb-1 block text-slate-500">Приоритет</span>
            <input
              type="number"
              min={1}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 1)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 outline-none focus:border-primary"
            />
          </label>
        </div>

        <div className="space-y-2">
          {STAGE_ORDER.map((type) => {
            const d = stages[type];
            const isReview = type === 'review';
            const locked = isReview && reviewLockedTo !== null;
            const options = assigneePool(type, employees);
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
          Ревью кода автоматически назначается на лида, выбранного для архитектуры.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40"
          >
            {isEdit ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  );
}
