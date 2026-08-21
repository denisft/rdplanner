import { describe, it, expect } from 'vitest';
import { explainPlacement, rangeLabel } from './explain';
import type { StagePlacement } from './scheduler';
import { schedule } from './scheduler';
import type { AppData } from '../types';

function placement(p: Partial<StagePlacement>): StagePlacement {
  return { startDate: '2026-06-04', factors: [], conflicts: [], ...p };
}

describe('rangeLabel', () => {
  it('один день', () => {
    expect(rangeLabel('2026-07-14', '2026-07-14')).toBe('14 июл');
  });

  it('диапазон внутри месяца — месяц один раз', () => {
    expect(rangeLabel('2026-07-12', '2026-07-13')).toBe('12–13 июл');
  });

  it('диапазон через месяц — обе даты полностью', () => {
    expect(rangeLabel('2026-06-30', '2026-07-02')).toBe('30 июн – 2 июл');
  });
});

describe('explainPlacement', () => {
  it('ничего не мешало — заголовок без списка причин', () => {
    const e = explainPlacement(placement({ startDate: '2026-06-01' }));
    expect(e.headline).toBe('Начинается 1 июн — ничто не мешало начать раньше');
    expect(e.lines).toEqual([]);
  });

  it('занятость исполнителя: имя, даты, задача и этап', () => {
    const e = explainPlacement(
      placement({
        factors: [
          {
            kind: 'busy',
            stageId: 's1',
            taskId: 't1',
            taskName: 'Оплата',
            stageType: 'review',
            pinned: false,
            from: '2026-07-09',
            to: '2026-07-10',
          },
        ],
      }),
      'Пётр',
    );
    expect(e.headline).toBe('Не раньше 4 июн, потому что:');
    expect(e.lines).toEqual(['Пётр занят 9–10 июл — «Оплата» · Ревью кода']);
  });

  it('без имени исполнителя текст обезличенный', () => {
    const e = explainPlacement(
      placement({ factors: [{ kind: 'unavailable', from: '2026-07-12', to: '2026-07-13' }] }),
    );
    expect(e.lines).toEqual([
      'исполнитель недоступен 12–13 июл (отпуск или больничный)',
    ]);
  });

  it('обтекаемый закреплённый этап помечен в тексте', () => {
    const e = explainPlacement(
      placement({
        factors: [
          {
            kind: 'busy',
            stageId: 's1',
            taskId: 't1',
            taskName: 'Каталог',
            stageType: 'development',
            pinned: true,
            from: '2026-07-09',
            to: '2026-07-09',
          },
        ],
      }),
      'Пётр',
    );
    expect(e.lines).toEqual([
      'Пётр занят 9 июл — «Каталог» · Разработка (закреплён вручную)',
    ]);
  });

  it('предыдущий этап, короткое окно и отсутствие исполнителя', () => {
    const e = explainPlacement(
      placement({
        factors: [
          {
            kind: 'prevStage',
            stageId: 's0',
            stageType: 'development',
            endDate: '2026-07-11',
          },
          { kind: 'shortGap', freeDays: 2, neededDays: 3 },
          { kind: 'noAssignee' },
        ],
      }),
    );
    expect(e.lines).toEqual([
      'предыдущий этап «Разработка» заканчивается 11 июл',
      'свободное окно короче этапа: подряд было 2 дн, нужно 3',
      'исполнитель не назначен — этап учтён по времени, но ничью загрузку не занимает',
    ]);
  });

  it('закреплённый вручную этап: причина в заголовке, в списке её нет', () => {
    const e = explainPlacement(
      placement({ factors: [{ kind: 'manualPin', date: '2026-07-14' }] }),
    );
    expect(e.headline).toBe('Закреплён вручную на 14 июл');
    expect(e.lines).toEqual([]);
  });

  it('не удалось разместить', () => {
    const e = explainPlacement(
      placement({ startDate: null, factors: [{ kind: 'noSlot' }] }),
    );
    expect(e.headline).toBe('Разместить не удалось');
    expect(e.lines).toEqual([
      'свободного окна не нашлось до конца расчётного горизонта',
    ]);
  });

  it('наложения выводятся отдельным списком', () => {
    const e = explainPlacement(
      placement({
        conflicts: [
          {
            stageId: 's9',
            taskId: 't9',
            taskName: 'Срочная',
            stageType: 'qa',
            pinned: true,
            from: '2026-07-14',
            to: '2026-07-15',
          },
        ],
      }),
    );
    expect(e.conflicts).toEqual(['14–15 июл — «Срочная» · QA (закреплён вручную)']);
  });

  it('объяснения нет — честная заглушка вместо пустоты', () => {
    expect(explainPlacement(undefined).headline).toBe(
      'Причина размещения неизвестна',
    );
  });

  it('сквозной случай: текст собирается из настоящего расписания', () => {
    // 2026-06-01 — понедельник. Пётр занят важной задачей пн–ср и в отпуске в чт.
    const data: AppData = {
      teams: [{ id: 'team-1', name: 'Команда 1' }],
      employees: [
        {
          id: 'dev',
          name: 'Пётр',
          specialization: 'backend',
          unavailable: [{ from: '2026-06-04', to: '2026-06-04' }],
        },
      ],
      tasks: [
        {
          id: 't1',
          name: 'Важная',
          priority: 1,
          stages: [
            { id: 's1', type: 'development', durationDays: 3, assigneeId: 'dev' },
          ],
        },
        {
          id: 't2',
          name: 'Вторая',
          priority: 2,
          stages: [
            { id: 's2', type: 'development', durationDays: 2, assigneeId: 'dev' },
          ],
        },
      ],
      horizonStart: '2026-06-01',
      horizonWeeks: 4,
    };
    const r = schedule(data);
    const e = explainPlacement(r.reasons.get('s2'), 'Пётр');
    expect(e.headline).toBe('Не раньше 5 июн, потому что:');
    expect(e.lines).toEqual([
      'Пётр занят 1–3 июн — «Важная» · Разработка',
      'Пётр недоступен 4 июн (отпуск или больничный)',
    ]);
  });
});
