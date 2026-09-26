// Контекст тостов: провайдер — ToastProvider в Toast.tsx.

import { createContext, useContext } from 'react';

export interface ToastOptions {
  kind?: 'ok' | 'error';
  /** Кнопка в тосте, напр. «Отменить». */
  action?: { label: string; onClick: () => void };
}

export type ToastFn = (text: string, opts?: ToastOptions) => void;

export const ToastContext = createContext<ToastFn>(() => {});

export const useToast = () => useContext(ToastContext);
