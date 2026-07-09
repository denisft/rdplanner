import type { StageType } from '../types';

/** Цвет блока по типу этапа (фон / текст / бордер). */
export const STAGE_STYLE: Record<StageType, string> = {
  architecture: 'bg-indigo-500 text-white',
  development: 'bg-sky-500 text-white',
  review: 'bg-amber-400 text-amber-950',
  qa: 'bg-emerald-500 text-white',
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
  if (p <= 1) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (p === 2) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};
