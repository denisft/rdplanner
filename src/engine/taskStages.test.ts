import { describe, it, expect } from 'vitest';
import { buildTaskStagesReport } from './taskStages';
import type { AppData, Task } from '../types';

function base(tasks: Task[]): AppData {
  // 2026-06-01 — понедельник.
  return { teams: [{ id: 'team-1', name: 'Команда 1' }], employees: [], tasks, horizonStart: '2026-06-01', horizonWeeks: 4 };
}

describe('buildTaskStagesReport', () => {
  it('суммирует плановые дни по типам этапов и считает итоги', () => {
    const report = buildTaskStagesReport(
      base([
        {
          id: 't1',
          name: 'A',
          priority: 1,
          stages: [
            { id: 's1', type: 'architecture', durationDays: 2, assigneeId: 'lead' },
            { id: 's2', type: 'development', durationDays: 8, assigneeId: 'dev' },
            { id: 's3', type: 'qa', durationDays: 3, assigneeId: null },
          ],
        },
        {
          id: 't2',
          name: 'B',
          priority: 2,
          stages: [{ id: 's4', type: 'development', durationDays: 5, assigneeId: 'dev' }],
        },
      ]),
    );

    expect(report.rows[0].byType).toEqual({ architecture: 2, development: 8, review: 0, qa: 3 });
    expect(report.rows[0].totalDays).toBe(13);
    expect(report.rows[1].byType).toEqual({ architecture: 0, development: 5, review: 0, qa: 0 });
    expect(report.totalByType).toEqual({ architecture: 2, development: 13, review: 0, qa: 3 });
    expect(report.totalDays).toBe(18);
  });

  it('завершённые входят целиком, даже если этапы закреплены до начала горизонта', () => {
    const report = buildTaskStagesReport(
      base([
        {
          id: 't1',
          name: 'Старая',
          priority: 1,
          done: true,
          stages: [
            { id: 's1', type: 'development', durationDays: 10, assigneeId: 'dev', pinnedStartDate: '2026-03-02' },
            { id: 's2', type: 'qa', durationDays: 4, assigneeId: 'qa', pinnedStartDate: '2026-03-16' },
          ],
        },
      ]),
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].done).toBe(true);
    expect(report.rows[0].totalDays).toBe(14);
  });

  it('сначала задачи в работе по приоритету, потом завершённые', () => {
    const stages: Task['stages'] = [{ id: 's', type: 'development', durationDays: 1, assigneeId: null }];
    const report = buildTaskStagesReport(
      base([
        { id: 't1', name: 'Готова', priority: 1, done: true, stages },
        { id: 't2', name: 'Вторая', priority: 3, stages },
        { id: 't3', name: 'Первая', priority: 2, stages },
      ]),
    );

    expect(report.rows.map((r) => r.taskName)).toEqual(['Первая', 'Вторая', 'Готова']);
  });

  it('пустой план — пустой отчёт с нулевыми итогами', () => {
    const report = buildTaskStagesReport(base([]));
    expect(report.rows).toEqual([]);
    expect(report.totalDays).toBe(0);
  });
});
