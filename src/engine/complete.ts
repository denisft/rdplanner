// Завершение задачи: история не должна ездить при правках соседних задач,
// поэтому при отметке «завершено» все этапы закрепляются на текущих
// рассчитанных датах (pinnedStartDate) — движок дальше обтекает их как
// обычные закреплённые. Возврат в работу снимает флаг, но закрепления
// оставляет: ничего не прыгает, открепить можно как обычно (двойной клик).

import type { AppData } from '../types';
import type { ScheduleResult } from './scheduler';

/** Отметить задачу завершённой, заморозив этапы на их текущих датах. */
export function completeTask(
  data: AppData,
  result: ScheduleResult,
  taskId: string,
  completedAt: string,
): AppData {
  const startByStage = new Map<string, string>();
  for (const s of result.scheduledStages) {
    if (s.taskId === taskId && s.startIndex >= 0) {
      startByStage.set(s.stageId, result.days[s.startIndex]);
    }
  }
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            done: true,
            completedAt,
            stages: t.stages.map((s) => {
              const start = startByStage.get(s.id);
              // Этап без исполнителя не закрепляем: движок игнорирует
              // pinnedStartDate без assigneeId, дата была бы мёртвой.
              return start && s.assigneeId
                ? { ...s, pinnedStartDate: start }
                : s;
            }),
          }
        : t,
    ),
  };
}

/** Вернуть завершённую задачу в работу (закрепления этапов сохраняются). */
export function reopenTask(data: AppData, taskId: string): AppData {
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      t.id === taskId ? { ...t, done: false, completedAt: undefined } : t,
    ),
  };
}
