// Контекст окна подтверждения: провайдер — ConfirmProvider в Dialog.tsx.

import { createContext, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Разрушительное действие: красная кнопка подтверждения. */
  danger?: boolean;
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);
