// Кнопки интерфейса. Все цвета — через токены темы (index.css), поэтому
// кнопки одинаково работают в светлой и тёмной теме.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tip } from './Tooltip';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonClass';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'outline', size = 'md', className = '', type = 'button', ...rest }, ref) => (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />
  ),
);
Button.displayName = 'Button';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Подпись: уходит и в aria-label, и в подсказку по наведению. */
  label: string;
  /** Горячая клавиша — показывается в подсказке. */
  shortcut?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Квадратная кнопка-иконка: название и клавиша видны в подсказке. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, shortcut, variant = 'ghost', size = 'md', className = '', type = 'button', ...rest },
    ref,
  ) => (
    <Tip label={label} shortcut={shortcut}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={buttonClass(
          variant,
          size,
          `${size === 'sm' ? 'w-[30px]' : 'w-[34px]'} !px-0 ${className}`,
        )}
        {...rest}
      />
    </Tip>
  ),
);
IconButton.displayName = 'IconButton';

/** Клавиша в подсказках и шпаргалке. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-b-2 border-line bg-surface-2 px-1.5 font-sans text-[11.5px] font-semibold text-faint tabular-nums">
      {children}
    </kbd>
  );
}
