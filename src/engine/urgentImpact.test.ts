import { describe, it, expect } from 'vitest';
import { urgentImpact } from './urgentImpact';
import type { AppData, Employee, Task } from '../types';

function emp(id: string, name = id): Employee {
  return { id, name, specialization: 'backend', unavailable: [] };
}

function base(tasks: Task[], employees: Employee[]): AppData {
  // 2026-06-01 — понедельник.
  return { employees, tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

/** Срочная задача с одним этапом разработки, закреплённым на дате старта. */
function urgentDev(
  assigneeId: string,
  durationDays: number,
  pinnedStartDate: string | null = '2026-06-01',
): Task {
  return {
    id: 'urgent',
    name: 'Срочная',
    priority: 0,
    stages: [
      { id: 'u-dev', type: 'development', durationDays, assigneeId, pinnedStartDate },
    ],
  };
}

describe('urgentImpact', () => {
  it('свободный слот — отчёт пуст, релиз срочной посчитан', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Позже',
          priority: 1,
          stages: [
            {
              id: 's1',
              type: 'development',
              durationDays: 2,
              assigneeId: 'dev',
              // Закреплена на второй неделе — до неё срочная не дотягивается.
              pinnedStartDate: '2026-06-15',
            },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = urgentImpact(data, urgentDev('dev', 3));
    expect(r.rows).toHaveLength(0);
    expect(r.urgentUnplaced).toBe(false);
    // QA срочной кончается в ср 3 июн → ближайший вт/чт строго после — чт 4 июн.
    expect(r.urgentRelease).toBe('2026-06-04');
  });

  it('конфликт за разработчика — задача в отчёте со сдвигом', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Обычная',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 5, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = urgentImpact(data, urgentDev('dev', 3));
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.taskId).toBe('t1');
    expect(row.shiftDays).toBe(3);
    expect(row.outcome).toBe('shift');
    expect(row.releaseAfter! > row.releaseBefore!).toBe(true);
  });

  it('удар через лида: задета задача, у которой срочная занимает только архитектора', () => {
    const data = base(
      [
        {
          id: 'x',
          name: 'На лиде',
          priority: 1,
          stages: [
            { id: 'x-a', type: 'architecture', durationDays: 2, assigneeId: 'lead' },
            { id: 'x-d', type: 'development', durationDays: 3, assigneeId: 'devA' },
          ],
        },
      ],
      [emp('lead'), emp('devA'), emp('devB')],
    );
    // Разработку срочной делает другой человек (devB), но архитектура и ревью — лид.
    const urgent: Task = {
      id: 'urgent',
      name: 'Срочная',
      priority: 0,
      stages: [
        {
          id: 'u-a',
          type: 'architecture',
          durationDays: 2,
          assigneeId: 'lead',
          pinnedStartDate: '2026-06-01',
        },
        { id: 'u-d', type: 'development', durationDays: 2, assigneeId: 'devB' },
        { id: 'u-r', type: 'review', durationDays: 1, assigneeId: 'lead' },
      ],
    };
    const r = urgentImpact(data, urgent);
    // Задача уехала, хотя её разработчика (devA) срочная не трогает.
    expect(r.rows.map((x) => x.taskId)).toEqual(['x']);
    expect(r.rows[0].shiftDays).toBe(2);
  });

  it('задача на незадетом человеке в отчёт не попадает', () => {
    const data = base(
      [
        {
          id: 'other',
          name: 'Чужая',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 4, assigneeId: 'devB' },
          ],
        },
      ],
      [emp('devA'), emp('devB')],
    );
    const r = urgentImpact(data, urgentDev('devA', 3));
    expect(r.rows).toHaveLength(0);
  });

  it('приоритет 0 двигает даже задачу с приоритетом 1 (без закрепления)', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Важная',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 4, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    // Без pinnedStartDate: срочная выигрывает слот чисто за счёт приоритета.
    const r = urgentImpact(data, urgentDev('dev', 2, null));
    expect(r.rows.map((x) => x.taskId)).toEqual(['t1']);
    expect(r.rows[0].shiftDays).toBe(2);
  });

  it('сортировка: первым идёт больший сдвиг', () => {
    const data = base(
      [
        {
          id: 'tA',
          name: 'A',
          priority: 1,
          stages: [
            { id: 'a-d', type: 'development', durationDays: 4, assigneeId: 'devA' },
          ],
        },
        {
          id: 'tB',
          name: 'B',
          priority: 2,
          stages: [{ id: 'b-q', type: 'qa', durationDays: 4, assigneeId: 'qaE' }],
        },
      ],
      [emp('devA'), emp('qaE')],
    );
    // Срочная: разработка на devA (дни 0-1), затем QA на qaE (дни 2-4).
    const urgent: Task = {
      id: 'urgent',
      name: 'Срочная',
      priority: 0,
      stages: [
        {
          id: 'u-d',
          type: 'development',
          durationDays: 2,
          assigneeId: 'devA',
          pinnedStartDate: '2026-06-01',
        },
        { id: 'u-q', type: 'qa', durationDays: 3, assigneeId: 'qaE' },
      ],
    };
    const r = urgentImpact(data, urgent);
    // tB: блок из 4 дней не влезает до QA срочной (дни 2-4) → старт с 5-го, сдвиг 5.
    // tA: разработка уезжает на 2.
    expect(r.rows.map((x) => x.taskId)).toEqual(['tB', 'tA']);
    expect(r.rows[0].shiftDays).toBe(5);
    expect(r.rows[1].shiftDays).toBe(2);
  });

  it('срочная не влезла в горизонт — urgentUnplaced, отчёт не падает', () => {
    const data = base([], [emp('dev')]);
    // 300 рабочих дней не помещаются в расчётный горизонт (260).
    const r = urgentImpact(data, urgentDev('dev', 300, null));
    expect(r.urgentUnplaced).toBe(true);
    expect(r.urgentRelease).toBeNull();
    expect(r.rows).toHaveLength(0);
  });

  it('завершённые задачи в отчёт не попадают', () => {
    const data = base(
      [
        {
          id: 'done',
          name: 'Завершённая',
          priority: 1,
          done: true,
          completedAt: '2026-05-29',
          stages: [
            // Незакреплённый этап завершённой (патология) — даже если движок
            // его подвинет, в отчёте «кого задело» её быть не должно.
            { id: 'sd', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const r = urgentImpact(data, urgentDev('dev', 2));
    expect(r.rows).toHaveLength(0);
  });

  it('не мутирует исходные данные', () => {
    const data = base(
      [
        {
          id: 't1',
          name: 'Обычная',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 5, assigneeId: 'dev' },
          ],
        },
      ],
      [emp('dev')],
    );
    const snapshot = JSON.stringify(data);
    urgentImpact(data, urgentDev('dev', 3));
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(data.tasks).toHaveLength(1);
  });
});
