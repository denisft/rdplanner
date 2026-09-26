// Классы кнопки — отдельно от компонентов: нужны и ссылкам <a>, оформленным как кнопка.

export type ButtonVariant = 'primary' | 'soft' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-white hover:brightness-110',
  soft: 'border-transparent bg-primary-light text-primary-ink hover:brightness-95',
  outline: 'border-line bg-surface text-ink hover:bg-hover',
  ghost: 'border-transparent bg-transparent text-ink hover:bg-hover',
  danger: 'border-transparent bg-danger text-white hover:brightness-110',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[30px] gap-1.5 rounded-[9px] px-2.5 text-[13px]',
  md: 'h-[34px] gap-[7px] rounded-[10px] px-3 text-sm',
};

export const buttonClass = (
  variant: ButtonVariant = 'outline',
  size: ButtonSize = 'md',
  extra = '',
) =>
  `inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border font-semibold transition-[background-color,filter] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
