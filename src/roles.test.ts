import { describe, it, expect } from 'vitest';
import { stageAllows, assigneePool } from './roles';
import type { Employee } from './types';

function emp(
  id: string,
  specialization: Employee['specialization'],
  extraStages?: Employee['extraStages'],
): Employee {
  return { id, name: id, specialization, unavailable: [], extraStages };
}

describe('stageAllows', () => {
  it('по базе архитектуру и ревью может только лид', () => {
    const dev = emp('dev', 'backend');
    expect(stageAllows('architecture', dev)).toBe(false);
    expect(stageAllows('review', dev)).toBe(false);
    expect(stageAllows('development', dev)).toBe(true);
  });

  it('персональное право пускает разработчика на архитектуру и ревью', () => {
    const senior = emp('senior', 'frontend', ['architecture', 'review']);
    expect(stageAllows('architecture', senior)).toBe(true);
    expect(stageAllows('review', senior)).toBe(true);
  });

  it('доп-этап не ломает базовые права (qa остаётся за qa)', () => {
    const senior = emp('senior', 'backend', ['architecture']);
    expect(stageAllows('qa', senior)).toBe(false);
  });
});

describe('assigneePool', () => {
  it('включает разработчика с выданным правом на архитектуру', () => {
    const team = [
      emp('lead', 'lead'),
      emp('dev', 'backend'),
      emp('senior', 'frontend', ['architecture']),
    ];
    const pool = assigneePool('architecture', team).map((e) => e.id);
    expect(pool).toContain('lead');
    expect(pool).toContain('senior');
    expect(pool).not.toContain('dev');
  });
});
