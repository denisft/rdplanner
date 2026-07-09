// Доменная модель планировщика ресурсов.
// Время измеряется в рабочих днях (пн–пт). Единица планирования — 1 день.

export type Specialization = 'lead' | 'backend' | 'frontend' | 'qa';

export const SPECIALIZATION_LABELS: Record<Specialization, string> = {
  lead: 'Лиды разработки',
  backend: 'Разработчики бэк',
  frontend: 'Разработчики фронт',
  qa: 'QA',
};

export const SPECIALIZATION_ORDER: Specialization[] = [
  'lead',
  'backend',
  'frontend',
  'qa',
];

/** Диапазон недоступности (отпуск/больничный), даты включительно, формат YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

export interface Employee {
  id: string;
  name: string;
  specialization: Specialization;
  /** Дни, когда человек недоступен. */
  unavailable: DateRange[];
  /**
   * Этапы, которые сотрудник может делать сверх базовых прав специализации.
   * Например, опытный разработчик с ['architecture'] допускается на архитектуру.
   * Отсутствует/пусто — только базовые права.
   */
  extraStages?: StageType[];
}

export type StageType = 'architecture' | 'development' | 'review' | 'qa';

export const STAGE_LABELS: Record<StageType, string> = {
  architecture: 'Архитектура',
  development: 'Разработка',
  review: 'Ревью кода',
  qa: 'QA',
};

/** Порядок этапов внутри задачи (строгая последовательность). */
export const STAGE_ORDER: StageType[] = [
  'architecture',
  'development',
  'review',
  'qa',
];

export interface Stage {
  id: string;
  type: StageType;
  /** Длительность в рабочих днях. */
  durationDays: number;
  /** Назначенный исполнитель. null — этап ещё не назначен. */
  assigneeId: string | null;
  /**
   * Ручное закрепление: дата старта (YYYY-MM-DD), куда пользователь перетащил этап.
   * Если задано — движок ставит этап ровно сюда (а не ищет слот сам).
   * null/undefined — автоматическое размещение.
   */
  pinnedStartDate?: string | null;
}

export interface Task {
  id: string;
  name: string;
  /** Ручной приоритет: меньше число = выше приоритет. Решает конфликты за человека. */
  priority: number;
  /** Этапы в порядке выполнения. У задачи может быть не весь набор из 4 этапов. */
  stages: Stage[];
  /**
   * Задача завершена: остаётся на ганте приглушённой и продолжает занимать
   * людей, но замораживается — при отметке все этапы закрепляются на текущих
   * рассчитанных датах (см. engine/complete.ts). Отсутствует — в работе.
   */
  done?: boolean;
  /** Дата отметки о завершении (YYYY-MM-DD), для сортировки архива. */
  completedAt?: string;
}

export interface AppData {
  employees: Employee[];
  tasks: Task[];
  /** Начало горизонта планирования, YYYY-MM-DD. */
  horizonStart: string;
  /** Сколько недель показывать в Гантте. */
  horizonWeeks: number;
}

export const SCHEMA_VERSION = 1;

export interface SavedFile {
  version: number;
  data: AppData;
}
