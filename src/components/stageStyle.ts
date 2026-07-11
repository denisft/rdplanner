import type { StageType } from '../types';

/** Цвет блока по типу этапа (фон / текст / бордер) — палитра MatDash. */
export const STAGE_STYLE: Record<StageType, string> = {
  architecture: 'bg-primary text-white',
  development: 'bg-secondary text-white',
  review: 'bg-warning text-amber-950',
  qa: 'bg-success text-emerald-950',
};

/**
 * Блок завершённой задачи: нейтральный серый вместо цвета этапа —
 * цвет на ганте означает только активную работу.
 */
export const DONE_STAGE_STYLE =
  'bg-slate-200 text-slate-500 ring-1 ring-inset ring-slate-300';

/**
 * Штриховка зоны недоступности (отпуск/больничный) на ганте.
 * Инлайн-стиль, а не класс Tailwind: используется и в подложке строки, и в легенде.
 */
export const UNAVAILABLE_STRIPES =
  'repeating-linear-gradient(135deg, rgb(148 163 184 / 0.35) 0 4px, transparent 4px 8px)';

export const PRIORITY_STYLE = (p: number): string => {
  if (p <= 1) return 'bg-error-light text-rose-600 border-error/30';
  if (p === 2) return 'bg-warning-light text-amber-600 border-warning/40';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};
