// Подсказка по наведению и фокусу (Radix Tooltip): название действия и,
// если есть, горячая клавиша. Заменяет нативный title у кнопок-иконок.

import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={350} skipDelayDuration={200}>
    {children}
  </RT.Provider>
);

export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[120] max-w-xs animate-fade rounded-[7px] bg-tip px-2 py-1 text-xs font-medium text-tip-ink"
        >
          {label}
          {shortcut && <span className="ml-1.5 opacity-60">{shortcut}</span>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
