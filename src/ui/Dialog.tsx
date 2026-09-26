// Модальные окна (Radix Dialog): фокус-ловушка, Esc, возврат фокуса.
// useConfirm() (useConfirm.ts) — замена window.confirm: своё окно в стиле приложения,
// возвращает Promise<boolean>.

import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './useConfirm';

/** Обычное окно с заголовком и крестиком (сотрудники, отчёт, шпаргалка). */
export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg',
  headerExtra,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Класс максимальной ширины окна. */
  width?: string;
  /** Кнопки в шапке окна слева от крестика. */
  headerExtra?: ReactNode;
}) {
  return (
    <RD.Root open onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[100] animate-fade bg-slate-950/35" />
        <RD.Content
          aria-describedby={undefined}
          className={`fixed top-1/2 left-1/2 z-[100] flex max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-pop flex-col rounded-2xl border border-line bg-surface text-ink shadow-pop outline-none ${width}`}
        >
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <RD.Title className="min-w-0 flex-1 text-[17px] font-bold tracking-tight">
              {title}
            </RD.Title>
            {headerExtra}
            <RD.Close asChild>
              <button
                aria-label="Закрыть"
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
              >
                <X size={18} />
              </button>
            </RD.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const finish = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <RD.Root open={opts !== null} onOpenChange={(o) => !o && finish(false)}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-[110] animate-fade bg-slate-950/35" />
          <RD.Content
            role="alertdialog"
            className="fixed top-1/2 left-1/2 z-[110] grid w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 animate-pop gap-2.5 rounded-2xl border border-line bg-surface p-5 text-ink shadow-pop outline-none"
          >
            <RD.Title className="text-[17px] font-bold tracking-tight">{opts?.title}</RD.Title>
            <RD.Description asChild>
              <div className="text-sm leading-relaxed text-muted">{opts?.text}</div>
            </RD.Description>
            <div className="mt-2 flex justify-end gap-2">
              <Button onClick={() => finish(false)}>{opts?.cancelLabel ?? 'Отмена'}</Button>
              <Button
                autoFocus
                variant={opts?.danger ? 'danger' : 'primary'}
                onClick={() => finish(true)}
              >
                {opts?.confirmLabel ?? 'Продолжить'}
              </Button>
            </div>
          </RD.Content>
        </RD.Portal>
      </RD.Root>
    </ConfirmContext.Provider>
  );
}
