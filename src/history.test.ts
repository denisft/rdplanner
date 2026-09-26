import { describe, it, expect } from 'vitest';
import { historyReducer } from './history';
import type { AppData } from './types';

const plan = (weeks: number): AppData => ({
  teams: [{ id: 't', name: 'Команда 1' }],
  employees: [],
  tasks: [],
  horizonStart: '2026-09-21',
  horizonWeeks: weeks,
});

const init = { data: plan(1), past: [], future: [], mergeKey: null };

describe('historyReducer — отмена и повтор правок плана', () => {
  it('правка кладёт снимок в отмену, undo возвращает, redo повторяет', () => {
    const s1 = historyReducer(init, { type: 'edit', next: plan(2) });
    expect(s1.data.horizonWeeks).toBe(2);
    const s2 = historyReducer(s1, { type: 'undo' });
    expect(s2.data.horizonWeeks).toBe(1);
    const s3 = historyReducer(s2, { type: 'redo' });
    expect(s3.data.horizonWeeks).toBe(2);
  });

  it('новая правка после отмены очищает повтор', () => {
    let s = historyReducer(init, { type: 'edit', next: plan(2) });
    s = historyReducer(s, { type: 'undo' });
    s = historyReducer(s, { type: 'edit', next: plan(3) });
    expect(s.future).toHaveLength(0);
    expect(historyReducer(s, { type: 'redo' }).data.horizonWeeks).toBe(3);
  });

  it('правки с одним ключом склейки — один шаг отмены', () => {
    let s = historyReducer(init, { type: 'edit', next: plan(2), mergeKey: 'p:1' });
    s = historyReducer(s, { type: 'edit', next: plan(3), mergeKey: 'p:1' });
    s = historyReducer(s, { type: 'edit', next: plan(4), mergeKey: 'p:1' });
    expect(historyReducer(s, { type: 'undo' }).data.horizonWeeks).toBe(1);
  });

  it('set меняет план без записи в историю', () => {
    const s = historyReducer(init, { type: 'set', next: (d) => ({ ...d, horizonWeeks: 8 }) });
    expect(s.data.horizonWeeks).toBe(8);
    expect(s.past).toHaveLength(0);
  });

  it('undo на пустой истории ничего не делает', () => {
    expect(historyReducer(init, { type: 'undo' })).toBe(init);
  });
});
