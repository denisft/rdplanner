// Счётчик предупреждений движка в шапке вместо жёлтой плашки над гантом:
// клик раскрывает полный список.

import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Check } from 'lucide-react';
import { Tip } from '../ui/Tooltip';

export function WarningsButton({ warnings }: { warnings: string[] }) {
  const n = warnings.length;
  if (n === 0) {
    return (
      <Tip label="Предупреждений нет: наложений и этапов без исполнителя нет">
        <span
          tabIndex={0}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-success-light px-2.5 text-[13px] font-bold text-success-ink"
        >
          <Check size={14} />0
        </span>
      </Tip>
    );
  }
  return (
    <Popover.Root>
      <Tip label={`Предупреждения: ${n}`}>
        <Popover.Trigger
          aria-label={`Предупреждения: ${n}`}
          className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full bg-warning-light px-2.5 text-[13px] font-bold text-warning-ink hover:brightness-95"
        >
          <AlertTriangle size={14} />
          {n}
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[95] grid max-h-[60vh] w-[min(380px,calc(100vw-24px))] animate-pop gap-px overflow-y-auto rounded-xl border border-line bg-surface p-[5px] text-sm text-ink shadow-pop"
        >
          <div className="px-2.5 pt-2 pb-1 text-[11px] font-extrabold tracking-[0.07em] text-faint uppercase">
            Предупреждения · {n}
          </div>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-lg px-2.5 py-[7px] leading-snug">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
              <span>{w}</span>
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
