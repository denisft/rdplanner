import type { StageType } from '../types';

/** Цвет блока по типу этапа (фон / текст) — токены темы из index.css. */
export const STAGE_STYLE: Record<StageType, string> = {
  architecture: 'bg-stage-arch text-stage-arch-ink',
  development: 'bg-stage-dev text-stage-dev-ink',
  review: 'bg-stage-review text-stage-review-ink',
  qa: 'bg-stage-qa text-stage-qa-ink',
};

/** Только фон этапа — для точек легенды и полоски этапов в таблице. */
export const STAGE_DOT: Record<StageType, string> = {
  architecture: 'bg-stage-arch',
  development: 'bg-stage-dev',
  review: 'bg-stage-review',
  qa: 'bg-stage-qa',
};

/**
 * Блок завершённой задачи: нейтральный серый вместо цвета этапа —
 * цвет на ганте означает только активную работу.
 */
export const DONE_STAGE_STYLE = 'bg-stage-done text-stage-done-ink';

/**
 * Штриховка зоны недоступности (отпуск/больничный) на ганте.
 * Инлайн-стиль, а не класс Tailwind: используется и в подложке строки, и в легенде.
 */
export const UNAVAILABLE_STRIPES =
  'repeating-linear-gradient(135deg, var(--color-vacation) 0 4px, transparent 4px 8px)';

export const PRIORITY_STYLE = (p: number): string => {
  if (p <= 0) return 'bg-danger text-white border-transparent';
  if (p === 1) return 'bg-error-light text-error-ink border-transparent';
  if (p === 2) return 'bg-warning-light text-warning-ink border-transparent';
  return 'bg-surface-2 text-muted border-line';
};

/** Цвет аватарки человека: стабильный по id, из приглушённой палитры. */
const AVATAR_COLORS = [
  '#6d5bd0',
  '#2f6fe0',
  '#0e8f7a',
  '#c2621b',
  '#b8407a',
  '#3d7f2a',
  '#7a5a18',
  '#1f7a99',
  '#8a3fb8',
];
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Инициалы для аватарки: «Александр С.» → «АС». */
export function initials(name: string): string {
  return name
    .replace(/[.\-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
