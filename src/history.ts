// История правок плана для отмены/повтора. Весь стейт — один редьюсер:
// снимок и сам апдейт меняются атомарно, а dispatch стабилен — кнопка
// «Отменить» в тосте работает, даже если тост создан несколько рендеров назад.

import { useReducer } from 'react';
import type { AppData } from './types';

/** Сколько шагов отмены помним. */
const HISTORY_LIMIT = 50;

interface HistoryState {
  data: AppData;
  past: AppData[];
  future: AppData[];
  /** Ключ склейки последней правки (посимвольный ввод приоритета). */
  mergeKey: string | null;
}

type Next = AppData | ((d: AppData) => AppData);

type Action =
  /** Правка плана: снимок в стек отмены + апдейт. */
  | { type: 'edit'; next: Next; mergeKey?: string }
  /** Замена без истории: загрузка по ссылке, настройки вида. */
  | { type: 'set'; next: Next }
  | { type: 'undo' }
  | { type: 'redo' };

const apply = (next: Next, d: AppData) => (typeof next === 'function' ? next(d) : next);

export function historyReducer(s: HistoryState, a: Action): HistoryState {
  switch (a.type) {
    case 'edit': {
      const data = apply(a.next, s.data);
      // Подряд идущие правки одного поля — один шаг отмены: Ctrl+Z
      // возвращает значение до начала ввода, а не откатывает по цифре.
      if (a.mergeKey && s.mergeKey === a.mergeKey) return { ...s, data };
      return {
        data,
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.data],
        future: [],
        mergeKey: a.mergeKey ?? null,
      };
    }
    case 'set':
      return { ...s, data: apply(a.next, s.data) };
    case 'undo': {
      if (s.past.length === 0) return s;
      return {
        data: s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        future: [...s.future, s.data],
        mergeKey: null,
      };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      return {
        data: s.future[s.future.length - 1],
        past: [...s.past, s.data],
        future: s.future.slice(0, -1),
        mergeKey: null,
      };
    }
  }
}

export function usePlanHistory(init: () => AppData) {
  const [state, dispatch] = useReducer(historyReducer, undefined, () => ({
    data: init(),
    past: [],
    future: [],
    mergeKey: null,
  }));
  return {
    data: state.data,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    /** Правка плана (попадает в отмену). */
    edit: (next: Next, mergeKey?: string) => dispatch({ type: 'edit', next, mergeKey }),
    /** Замена без истории. */
    set: (next: Next) => dispatch({ type: 'set', next }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
  };
}
