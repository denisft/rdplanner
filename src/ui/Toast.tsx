// Тосты: короткие сообщения внизу экрана вместо статусной строки под тулбаром.
// Успех гаснет сам; у сообщения с действием («Отменить») — больше времени;
// ошибка висит, пока её не закроют.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ToastContext, type ToastFn, type ToastOptions } from './useToast';

interface ToastItem extends ToastOptions {
  id: number;
  text: string;
}

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (text, opts = {}) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, text, ...opts }]);
      if (opts.kind !== 'error') {
        window.setTimeout(() => dismiss(id), opts.action ? 6000 : 3500);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-[calc(20px+env(safe-area-inset-bottom,0px))] left-1/2 z-[130] grid w-max max-w-[calc(100vw-32px)] -translate-x-1/2 justify-items-center gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex animate-toast items-center gap-3 rounded-xl py-2 pr-2 pl-3.5 text-[13.5px] font-semibold shadow-pop ${
              t.kind === 'error' ? 'bg-danger text-white' : 'bg-tip text-tip-ink'
            }`}
          >
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
                className="cursor-pointer rounded-md px-2 py-1 font-extrabold opacity-85 hover:bg-white/15 hover:opacity-100"
              >
                {t.action.label}
              </button>
            )}
            {(t.kind === 'error' || !t.action) && (
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Закрыть сообщение"
                className="cursor-pointer rounded-md p-1 opacity-60 hover:bg-white/15 hover:opacity-100"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
