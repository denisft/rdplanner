// Черновики этапов задачи и сборка их в Stage[]. Общая логика форм
// (TaskForm и UrgentTaskModal): дефолтные длительности, правило «ревью
// наследует лида архитектуры», генерация id.

import type { Stage, StageType, Task } from '../types';
import { STAGE_ORDER } from '../types';

export interface StageDraft {
  enabled: boolean;
  durationDays: number;
  assigneeId: string | null;
}

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const DEFAULT_DURATIONS: Record<StageType, number> = {
  architecture: 2,
  development: 5,
  review: 1,
  qa: 2,
};

export function defaultDrafts(enabled: boolean): Record<StageType, StageDraft> {
  const drafts = {} as Record<StageType, StageDraft>;
  for (const type of STAGE_ORDER) {
    drafts[type] = {
      enabled,
      durationDays: DEFAULT_DURATIONS[type],
      assigneeId: null,
    };
  }
  return drafts;
}

export function draftsFromTask(task: Task): Record<StageType, StageDraft> {
  const drafts = defaultDrafts(false);
  for (const stage of task.stages) {
    drafts[stage.type] = {
      enabled: true,
      durationDays: stage.durationDays,
      assigneeId: stage.assigneeId,
    };
  }
  return drafts;
}

/** Лид архитектуры, на которого автоматически назначается ревью (null — нет). */
export function reviewLockedTo(
  drafts: Record<StageType, StageDraft>,
): string | null {
  return drafts.architecture.enabled ? drafts.architecture.assigneeId : null;
}

/**
 * Собирает включённые черновики в Stage[] в порядке STAGE_ORDER.
 * При редактировании (existingTask) сохраняет id этапа и pinnedStartDate,
 * если этап уже существовал.
 */
export function buildStages(
  drafts: Record<StageType, StageDraft>,
  existingTask?: Task,
): Stage[] {
  const locked = reviewLockedTo(drafts);
  const built: Stage[] = [];
  for (const type of STAGE_ORDER) {
    const d = drafts[type];
    if (!d.enabled || d.durationDays <= 0) continue;
    const assigneeId =
      type === 'review' && locked !== null ? locked : d.assigneeId;

    const existingStage = existingTask?.stages.find((s) => s.type === type);
    built.push({
      id: existingStage?.id ?? uid(),
      type,
      durationDays: d.durationDays,
      assigneeId,
      pinnedStartDate: existingStage?.pinnedStartDate ?? null,
    });
  }
  return built;
}
