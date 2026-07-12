import { describe, expect, it } from 'vitest';
import {
  EDIT_KEY_RE,
  MAX_EMPLOYEES,
  MAX_TASKS,
  PLAN_ID_RE,
  planSizeBytes,
  validatePlanData,
} from './planGuards';

// Минимальный валидный план в форме, которую шлёт клиент.
function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    employees: [{ id: 'e1', name: 'Аня', specialization: 'backend' }],
    tasks: [{ id: 't1', name: 'Задача', priority: 1, stages: [] }],
    horizonStart: '2026-07-06',
    horizonWeeks: 4,
    ...overrides,
  };
}

describe('validatePlanData', () => {
  it('пропускает корректный план', () => {
    expect(validatePlanData(makePlan())).toBeNull();
  });

  it('пропускает план с неизвестными полями (схема может расти)', () => {
    expect(validatePlanData(makePlan({ futureField: 42 }))).toBeNull();
  });

  it('отклоняет не-объекты', () => {
    expect(validatePlanData(null)).not.toBeNull();
    expect(validatePlanData('строка')).not.toBeNull();
    expect(validatePlanData([])).not.toBeNull();
    expect(validatePlanData(undefined)).not.toBeNull();
  });

  it('отклоняет план без массивов employees/tasks', () => {
    expect(validatePlanData({ employees: [], tasks: 'нет' })).not.toBeNull();
    expect(validatePlanData({ tasks: [] })).not.toBeNull();
  });

  it('отклоняет сотрудника без строковых id/name', () => {
    expect(
      validatePlanData(makePlan({ employees: [{ id: 1, name: 'Аня' }] })),
    ).not.toBeNull();
    expect(
      validatePlanData(makePlan({ employees: [{ id: 'e1' }] })),
    ).not.toBeNull();
    expect(validatePlanData(makePlan({ employees: [null] }))).not.toBeNull();
  });

  it('отклоняет задачу без stages-массива', () => {
    expect(
      validatePlanData(makePlan({ tasks: [{ id: 't1', name: 'Т' }] })),
    ).not.toBeNull();
  });

  it('отклоняет превышение лимитов по количеству', () => {
    const manyEmployees = Array.from({ length: MAX_EMPLOYEES + 1 }, (_, i) => ({
      id: `e${i}`,
      name: `N${i}`,
    }));
    expect(
      validatePlanData(makePlan({ employees: manyEmployees })),
    ).not.toBeNull();

    const manyTasks = Array.from({ length: MAX_TASKS + 1 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      stages: [],
    }));
    expect(validatePlanData(makePlan({ tasks: manyTasks }))).not.toBeNull();
  });
});

describe('planSizeBytes', () => {
  it('считает байты, а не символы (кириллица — 2 байта в UTF-8)', () => {
    expect(planSizeBytes('ab')).toBe(4); // JSON: "ab"
    expect(planSizeBytes('аб')).toBe(6); // JSON: "аб" — кавычки + 2×2 байта
  });
});

describe('регэкспы id и editKey', () => {
  it('PLAN_ID_RE принимает uuid и отклоняет мусор', () => {
    expect(PLAN_ID_RE.test(crypto.randomUUID())).toBe(true);
    expect(PLAN_ID_RE.test('abc')).toBe(false); // короче 6
    expect(PLAN_ID_RE.test('плохой-id')).toBe(false);
    expect(PLAN_ID_RE.test('a'.repeat(65))).toBe(false);
    expect(PLAN_ID_RE.test('plan:взлом')).toBe(false);
  });

  it('EDIT_KEY_RE принимает uuid и отклоняет короткие ключи', () => {
    expect(EDIT_KEY_RE.test(crypto.randomUUID())).toBe(true);
    expect(EDIT_KEY_RE.test('short')).toBe(false);
  });
});
