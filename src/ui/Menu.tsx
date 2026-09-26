// Выпадающее меню (Radix DropdownMenu): клавиатура, фокус и закрытие по
// клику мимо / Esc — из коробки.

import * as DM from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ReactNode } from 'react';

export function Menu(props: DM.DropdownMenuProps) {
  return <DM.Root {...props} />;
}

export const MenuTrigger = forwardRef<HTMLButtonElement, DM.DropdownMenuTriggerProps>(
  (props, ref) => <DM.Trigger ref={ref} {...props} />,
);
MenuTrigger.displayName = 'MenuTrigger';

export function MenuContent({
  children,
  align = 'end',
  className = '',
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={`z-[95] grid min-w-[230px] max-w-[min(380px,calc(100vw-24px))] animate-pop gap-px rounded-xl border border-line bg-surface p-[5px] text-sm text-ink shadow-pop ${className}`}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  danger = false,
  disabled = false,
  onSelect,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] font-semibold outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-hover ${
        danger ? 'text-error-ink [&_svg]:text-error-ink' : '[&_svg]:text-muted'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut && <span className="text-xs font-semibold text-faint">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DM.Label className="px-2.5 pt-2 pb-1 text-[11px] font-extrabold tracking-[0.07em] text-faint uppercase">
      {children}
    </DM.Label>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="mx-0.5 my-1 h-px bg-line-soft" />;
}

/** Пояснение внутри меню (не пункт): например, ограничение браузера. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs leading-snug text-faint">{children}</div>;
}
