// Модалка «Отчёт за период»: выбор дат (пресеты или вручную) и готовый срез —
// загрузка команды, кто чем занят, стартующие/завершающиеся задачи.
// Всё считает buildPeriodReport; отсюда отчёт можно скопировать или скачать в .md.

import { useMemo, useState } from 'react';
import type { AppData } from '../types';
import { SPECIALIZATION_LABELS, STAGE_LABELS } from '../types';
import type { ScheduleResult } from '../engine/scheduler';
import { buildPeriodReport } from '../engine/report';
import type { EmployeePeriodReport } from '../engine/report';
import {
  buildReportMarkdown,
  downloadReportMarkdown,
} from '../export/reportMarkdown';
import { buildWeeklyLoadReport } from '../engine/weeklyLoad';
import { downloadWeeklyLoadCsv } from '../export/weeklyLoadCsv';
import { formatISO, parseISO, SHORT_MONTHS, SHORT_WEEKDAYS } from '../engine/dates';

interface Props {
  data: AppData;
  result: ScheduleResult;
  onClose: () => void;
}

type Preset = 'week' | 'two-weeks' | 'month';

// Последний использованный пресет — личное предпочтение зрителя, в localStorage.
const PRESET_KEY = 'resource-planner:report-preset';

const PRESET_LABELS: Record<Preset, string> = {
  week: 'Неделя',
  'two-weeks': '2 недели',
  month: 'Месяц',
};

function loadPreset(): Preset {
  try {
    const v = localStorage.getItem(PRESET_KEY);
    if (v === 'week' || v === 'two-weeks' || v === 'month') return v;
  } catch {
    // приватный режим — просто дефолт
  }
  return 'two-weeks';
}

/** Период пресета: от сегодня, «месяц» — по тот же день следующего месяца. */
function presetRange(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const to = new Date(today);
  if (preset === 'week') to.setDate(to.getDate() + 6);
  if (preset === 'two-weeks') to.setDate(to.getDate() + 13);
  if (preset === 'month') {
    to.setMonth(to.getMonth() + 1);
    to.setDate(to.getDate() - 1);
  }
  return { from: formatISO(today), to: formatISO(to) };
}

/** Дата с днём недели, напр. "15 июн, пн". */
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${SHORT_WEEKDAYS[d.getDay()]}`;
}

/** Бейдж статуса загрузки в сводке по сотруднику. */
function StatusBadge({ e }: { e: EmployeePeriodReport }) {
  if (e.status === 'overloaded') {
    return (
      <span
        className="rounded-full bg-error-light px-2 py-0.5 text-[11px] font-medium text-rose-700"
        title={`Дней с наложением этапов: ${e.overloadDays}`}
      >
        🔴 перегружен · {e.overloadDays} дн.
      </span>
    );
  }
  if (e.status === 'underloaded') {
    return (
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
        title={`Занято меньше половины доступных дней, свободно ${e.freeDays} дн.`}
      >
        ⚪ недогружен · свободно {e.freeDays} дн.
      </span>
    );
  }
  return null;
}

export function ReportModal({ data, result, onClose }: Props) {
  const initial = useMemo(() => presetRange(loadPreset()), []);
  const [preset, setPreset] = useState<Preset | null>(loadPreset);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [copied, setCopied] = useState(false);

  const report = useMemo(
    () => buildPeriodReport(data, result, from, to),
    [data, result, from, to],
  );

  const applyPreset = (p: Preset) => {
    const r = presetRange(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
    try {
      localStorage.setItem(PRESET_KEY, p);
    } catch {
      // приватный режим — настройка не переживёт перезагрузку
    }
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard?.writeText(buildReportMarkdown(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер недоступен (http без TLS и т.п.) — остаётся скачивание
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Отчёт за период</h2>
          <button
            onClick={onClose}
            className="rounded-full px-3.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Закрыть
          </button>
        </div>

        {/* Выбор периода: пресеты от сегодня + произвольные даты. */}
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${
                preset === p
                  ? 'border-primary bg-primary-light font-medium text-primary'
                  : 'border-slate-300 hover:bg-slate-100'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <label className="ml-2 text-sm">
            <span className="mb-1 block text-slate-500">С</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                if (!e.target.value) return;
                setFrom(e.target.value);
                setPreset(null);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 tabular-nums"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">По</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                if (!e.target.value) return;
                setTo(e.target.value);
                setPreset(null);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 tabular-nums"
            />
          </label>
          <span className="pb-1.5 text-xs text-slate-400">
            {report.totalDays} раб. дн.
          </span>
          <span className="ml-auto flex gap-2 pb-0.5">
            <button
              onClick={copyMarkdown}
              disabled={report.totalDays === 0}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
              title="Скопировать отчёт как markdown — вставить в письмо или чат"
            >
              {copied ? '✓ Скопировано' : 'Копировать .md'}
            </button>
            <button
              onClick={() => downloadReportMarkdown(report)}
              disabled={report.totalDays === 0}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              Скачать .md
            </button>
            <button
              onClick={() =>
                downloadWeeklyLoadCsv(buildWeeklyLoadReport(data, result, from, to))
              }
              disabled={report.totalDays === 0}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
              title="CSV по неделям: эпик × сотрудник × % загрузки — открыть в Excel"
            >
              Скачать .csv
            </button>
          </span>
        </div>

        {from > to && (
          <p className="mb-4 rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-xs text-amber-700">
            Дата «С» позже даты «По» — поправьте период.
          </p>
        )}

        {report.totalDays === 0 && from <= to && (
          <p className="mb-4 text-sm text-slate-500">
            В выбранном периоде нет рабочих дней внутри горизонта планирования.
          </p>
        )}

        {report.totalDays > 0 && (
          <div className="flex flex-col gap-5">
            {/* Кто чем занят + загрузка */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Кто чем занят
              </h3>
              <div className="flex flex-col gap-2">
                {report.employees.map((e) => (
                  <div
                    key={e.employeeId}
                    className="rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{e.name}</span>
                      <span className="text-xs text-slate-400">
                        {SPECIALIZATION_LABELS[e.specialization]}
                      </span>
                      <span className="text-xs tabular-nums text-slate-500">
                        занято {e.busyDays} из {e.availableDays} дн.
                        {e.freeDays > 0 && `, свободно ${e.freeDays}`}
                      </span>
                      <StatusBadge e={e} />
                    </div>
                    {e.stages.length > 0 ? (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-slate-600">
                        {e.stages.map((s, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                            <span className={s.done ? 'text-slate-400 line-through' : ''}>
                              {s.taskName} — {STAGE_LABELS[s.type]}
                              {s.done && ' ✓'}
                            </span>
                            <span className="text-xs tabular-nums text-slate-400">
                              {formatDay(s.startDate)} → {formatDay(s.endDate)} ·{' '}
                              {s.daysInPeriod} дн. в периоде
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400">
                        Нет этапов в этом периоде.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Стартуют в периоде ({report.starting.length})
              </h3>
              {report.starting.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-sm text-slate-600">
                  {report.starting.map((t) => (
                    <li key={t.taskId} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{t.taskName}</span>
                      <span className="text-xs tabular-nums text-slate-400">
                        начало {formatDay(t.startDate)} · релиз {formatDay(t.releaseDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">Нет задач, стартующих в периоде.</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Завершаются в периоде ({report.finishing.length})
              </h3>
              {report.finishing.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-sm text-slate-600">
                  {report.finishing.map((t) => (
                    <li key={t.taskId} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{t.taskName}</span>
                      <span className="text-xs tabular-nums text-slate-400">
                        QA готово {formatDay(t.qaEndDate)} · релиз 🚀 {formatDay(t.releaseDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">Нет релизов в периоде.</p>
              )}
            </section>

            {report.unassigned.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-amber-700">
                  ⚠️ Этапы без исполнителя ({report.unassigned.length})
                </h3>
                <ul className="flex flex-col gap-0.5 text-sm text-slate-600">
                  {report.unassigned.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span>
                        {s.taskName} — {STAGE_LABELS[s.type]}
                      </span>
                      <span className="text-xs tabular-nums text-slate-400">
                        {formatDay(s.startDate)} → {formatDay(s.endDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
