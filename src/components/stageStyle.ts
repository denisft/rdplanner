import type { StageType } from '../types';

/** Цвет блока по типу этапа (фон / текст / бордер). */
export const STAGE_STYLE: Record<StageType, string> = {
  architecture: 'bg-indigo-500 text-white',
  development: 'bg-sky-500 text-white',
  review: 'bg-amber-400 text-amber-950',
  qa: 'bg-emerald-500 text-white',
};

export const PRIORITY_STYLE = (p: number): string => {
  if (p <= 1) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (p === 2) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};
