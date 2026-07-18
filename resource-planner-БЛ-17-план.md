# БЛ-17 «Срочная задача» — план реализации

Детальная архитектура фичи: продакт вводит срочную задачу (дата старта + этапы с
исполнителями), получает отчёт «кого задело» (какие задачи уедут вправо и на
сколько рабочих дней), и одной кнопкой либо вносит её в рабочий план (один шаг
undo), либо закрывает без следов.

Ссылки: постановка — `resource-planner-BACKLOG.md`, п. БЛ-17. Смежное — БЛ-2
(what-if) и БЛ-5 (дробление этапа).

## Ключевой принцип

`schedule(data)` — чистая функция `AppData → ScheduleResult`. Весь предпросмотр
сводится к **двум прогонам движка** и **дельте по релизам**:

```
before = schedule(data)                                  // как сейчас
after  = schedule({ ...data, tasks: [...data.tasks, urgent] })
дельта = по каждому taskId: after.qaEndIndex − before.qaEndIndex
```

Рабочий стейт (`AppData`) при этом **не меняется**. Отчёт целиком производный, в
`AppData` / localStorage / файл / шаринг ничего нового не попадает. Модель не
трогаем — это требование техзаметки БЛ-17 и общий принцип проекта («объяснения и
отчёты производные»).

Разница исходов «остановится vs уедет вправо» упирается в БЛ-5: без дробления
движок двигает этап целиком, поэтому **любой конфликт = сдвиг вправо**. Значит на
этом этапе `outcome` всегда `'shift'`; поле в модели заводим сразу, чтобы UI и
тесты не переписывать под БЛ-5.

---

## Что меняется — карта файлов

| Файл | Тип | Что делаем |
|------|-----|------------|
| `src/engine/urgentImpact.ts` | **новый** | Ядро: два `schedule()`, дельта по релизам, тип `ImpactRow` |
| `src/engine/urgentImpact.test.ts` | **новый** | Тесты ядра (обязательно — изменение логики планирования) |
| `src/components/UrgentTaskModal.tsx` | **новый** | Модалка: форма срочной задачи + отчёт + «Применить»/«Отмена» |
| `src/components/urgentStageDraft.ts` | **новый (опц.)** | Общий helper сборки `Stage[]` из черновиков (вынесенный из `TaskForm`) |
| `src/App.tsx` | правка | Кнопка в тулбаре, стейт `showUrgent`, проброс `data`/`pushUndo`/`addTask`, рендер модалки, hotkey-guard |
| `src/components/TaskForm.tsx` | рефактор (опц.) | Вынести `draftsFromTask`/`submit`-сборку в общий helper, чтобы не дублировать логику этапов |

Ничего не меняется в: `types.ts` (кроме, возможно, экспорта хелпера), `scheduler.ts`,
`dates.ts`, `api/*`, `planGuards.ts`, автосейве.

---

## 1. Движок: `src/engine/urgentImpact.ts`

Чистый модуль без React. Единственная логика фичи, которую покрываем тестами.

```ts
import type { AppData, Task } from '../types';
import { schedule } from './scheduler';

/** Исход для затронутой задачи. Пока всегда 'shift' (см. БЛ-5). */
export type ImpactOutcome = 'shift' | 'stall';

export interface ImpactRow {
  taskId: string;
  taskName: string;
  /** Дата релиза до вставки срочной задачи. */
  releaseBefore: string | null;
  /** Дата релиза после вставки. */
  releaseAfter: string | null;
  /** Сдвиг окончания QA в рабочих днях (>0 = уехало вправо). */
  shiftDays: number;
  outcome: ImpactOutcome;
}

export interface UrgentImpact {
  /** Только затронутые задачи (shiftDays !== 0), по убыванию сдвига. */
  rows: ImpactRow[];
  /** Дата релиза самой срочной задачи в новом раскладе. */
  urgentRelease: string | null;
  /** Не удалось разместить срочную задачу в горизонте (edge case). */
  urgentUnplaced: boolean;
}

export function urgentImpact(base: AppData, urgent: Task): UrgentImpact {
  const before = schedule(base);
  const after = schedule({ ...base, tasks: [...base.tasks, urgent] });

  const beforeById = new Map(before.releases.map((r) => [r.taskId, r]));

  const rows: ImpactRow[] = [];
  let urgentRelease: string | null = null;
  let urgentUnplaced = false;

  for (const a of after.releases) {
    if (a.taskId === urgent.id) {
      urgentRelease = a.releaseDate;
      urgentUnplaced = a.qaEndIndex < 0; // движок не нашёл слот
      continue;
    }
    const b = beforeById.get(a.taskId);
    if (!b) continue;

    // Оба расписания строятся от одного horizonStart → индексы сравнимы напрямую.
    // Считаем в рабочих днях по qaEndIndex, а не по календарным датам релиза:
    // так не ловим артефакт округления правила вт/чт (nextReleaseDay).
    const shiftDays = a.qaEndIndex - b.qaEndIndex;
    if (shiftDays === 0) continue; // Q.4: не задело — не показываем

    rows.push({
      taskId: a.taskId,
      taskName: a.taskName,
      releaseBefore: b.releaseDate,
      releaseAfter: a.releaseDate,
      shiftDays,
      outcome: 'shift', // до БЛ-5 всегда сдвиг
    });
  }

  rows.sort((x, y) => y.shiftDays - x.shiftDays);
  return { rows, urgentRelease, urgentUnplaced };
}
```

### Почему сдвиг считается по `qaEndIndex`, а не по датам

`ScheduleResult.releases[].qaEndIndex` — индекс рабочего дня окончания QA. Разница
индексов = ровно сдвиг в рабочих днях. Календарная разница `releaseDate` шумит из-за
`nextReleaseDay` (вт/чт после QA): задача могла сдвинуться на 1 рабочий день, но
релиз перепрыгнуть с вторника на четверг = «+2 календарных». В отчёт выводим и
`shiftDays` (честные рабочие дни), и обе даты релиза (для наглядности «было → стало»).

### Удар по всем этапам, а не только по разработке

Отдельного кода не требует — это уже так работает в `scheduler.ts`. Движок ведёт
занятость по каждому `assigneeId` (`busyByEmployee`). Срочная задача с этапами
`architecture(Лид) → development(Вася) → review(Лид) → qa(Катя)` занимает **всех
троих**. Существующая задача уедет вправо, если её исполнитель попал под любой из
этих этапов, а не только под разработку. Дельта по `qaEndIndex` это ловит
автоматически. Тестами фиксируем именно это (см. кейс «удар через лида»).

---

## 2. Тесты: `src/engine/urgentImpact.test.ts`

Минимальный набор (Vitest, как `scheduler.test.ts`). Строим маленький `AppData` с
2–3 сотрудниками и задачами, вызываем `urgentImpact`, проверяем `rows`.

- **Свободный слот → пустой отчёт.** Срочная задача на человеке, у которого есть
  окно раньше существующих задач → `rows` пуст.
- **Конфликт за разработчика → сдвиг.** Срочная занимает Васю, у него уже стоит
  задача → она в `rows` с `shiftDays > 0`, `releaseAfter > releaseBefore`.
- **Удар через лида (архитектура+ревью).** Срочная задача, где разработку делает
  Вася, но архитектуру/ревью — Лид; существующая задача висит **на лиде** →
  она в отчёте, хотя разработчик у неё другой. Ключевой кейс: удар не только по dev.
- **Другой исполнитель не задет.** Задача на человеке, которого срочная не
  трогает → её нет в `rows`.
- **Приоритет.** Срочная с `priority = 0` двигает даже задачу с `priority = 1`
  (проверяем, что вставка идёт раньше по очереди размещения).
- **Сортировка.** Две затронутые задачи → в `rows` первой идёт с большим `shiftDays`.
- **Срочная не влезла.** Патологический горизонт → `urgentUnplaced === true`,
  отчёт не падает.
- **База не мутировала.** После `urgentImpact(base, urgent)` объект `base` и его
  `tasks` не изменились (важно — вставляем через spread, но фиксируем тестом).

---

## 3. UI: `src/components/UrgentTaskModal.tsx`

Отдельная модалка. Форму этапов переиспользуем из логики `TaskForm` (см. рефактор
ниже), плюс одно поле — **дата старта**. Внутренний стейт — локальный, наружу
ничего не течёт до «Применить».

### Пропсы

```ts
interface Props {
  data: AppData;                 // рабочий план (для расчёта и пула исполнителей)
  onApply: (urgent: Task) => void; // App делает pushUndo() + addTask()
  onClose: () => void;             // «Отмена» — просто закрыть
}
```

### Внутренний стейт

- `name` — название (дефолт пустой / «Срочная задача»).
- `startDate` — дата старта, дефолт = сегодня (`formatISO(new Date())`), нормализуем
  к ближайшему рабочему дню.
- `stages: Record<StageType, StageDraft>` — те же черновики, что в `TaskForm`
  (`enabled / durationDays / assigneeId`), дефолт — все 4 включены.
- `priority` — не показываем, фиксируем `0` (высший). См. открытый вопрос ниже.

### Сборка срочной задачи (`buildUrgentTask`)

Как `TaskForm.submit`, с двумя отличиями:

1. `priority = 0`.
2. У **первого включённого этапа** проставляем `pinnedStartDate = startDate` — это
   и есть «начинаем такого-то числа». Остальные этапы — авторазмещение (движок
   выстроит их следом, обтекая занятость).

```ts
const stagesArr = buildStages(stages, employees); // общий helper (см. §5)
if (stagesArr.length > 0) stagesArr[0].pinnedStartDate = startDate;
const urgent: Task = { id: uid(), name: name.trim(), priority: 0, stages: stagesArr };
```

### Живой пересчёт отчёта

```ts
const impact = useMemo(() => urgentImpact(data, urgent), [data, urgent]);
```

`urgent` пересобираем из стейта формы на каждый ввод (или через `useMemo` по
`[name, startDate, stages]`). Два прогона `schedule()` на ~260 дней — дёшево, как
основной `useMemo` в App; debounce не нужен.

### Разметка (стиль MatDash, как в макете)

Шапка «⚡ Срочная задача» (иконка на `bg-error-light`/`text-error`) · крестик.
Тело:
- строка: название + пилюля «приоритет 0»;
- поле «Старт — pin первого этапа» (`<input type="date">`);
- список этапов (чекбокс + `durationDays` + `select` исполнителя) — 1-в-1 из
  `TaskForm`, с тем же правилом «ревью наследует лида архитектуры»;
- секция «Кого задело»: пилюля-сводка «N задач сдвинутся»; список карточек
  `impact.rows` (задача · «Исполнитель занят на „Архитектура + Ревью"» · релиз
  было → стало · пилюля «уедет вправо» · `+N дн`); если `rows` пуст — зелёная
  плашка «Никого не задело»; если `urgentUnplaced` — предупреждение «срочная не
  влезает в горизонт».

Подпись «чем занят человек» строим из `urgent.stages.filter(s => s.assigneeId ===
row.assignee)` → лейблы через `STAGE_LABELS`. (Для этого в `ImpactRow` удобно
дополнительно вернуть `assigneeId` затронутой задачи — берётся из
`before.scheduledStages`/`releases`; либо считаем в модалке по `data`.)

Футер: слева «Рабочий план не тронут»; справа кнопки **«Отмена»** (`onClose`) и
**«Применить · 1× Ctrl+Z»** (accent).

Правила формулировок: заголовок — просто «Срочная задача» (без «предпросмотр
удара»), кнопка отмены — «Отмена» (не «Отбросить»).

---

## 4. Интеграция в `src/App.tsx`

1. **Импорт + стейт:**
   ```ts
   import { UrgentTaskModal } from './components/UrgentTaskModal';
   const [showUrgent, setShowUrgent] = useState(false);
   ```
2. **Кнопка в тулбаре** — рядом с «+ Задача» (App.tsx ~601), красный акцент:
   ```tsx
   <button onClick={() => setShowUrgent(true)}
     className="rounded-full border border-error/40 bg-error-light px-4 py-1.5 text-sm font-medium text-error hover:bg-error-light/70">
     ⚡ Срочная
   </button>
   ```
   Прятать в read-only (`?plan=...`) — как остальные редактирующие кнопки.
3. **Рендер модалки** — рядом с `{showForm && <TaskForm .../>}` (App.tsx ~1092):
   ```tsx
   {showUrgent && (
     <UrgentTaskModal
       data={data}
       onApply={(urgent) => { pushUndo(); addTask(urgent); setShowUrgent(false); }}
       onClose={() => setShowUrgent(false)}
     />
   )}
   ```
   «Применить» = `pushUndo()` (App.tsx:229) + `addTask()` (App.tsx:194). Один
   Ctrl+Z откатывает вставку целиком (Q.5). «Отмена» ничего не пишет → следов нет,
   в автосейв не попадает (`autosave` срабатывает только на изменение `data`).
4. **Hotkey-guard** — добавить `showUrgent` в условие, глушащее Ctrl+Z ганта,
   чтобы undo не срабатывал под открытой модалкой (App.tsx:289 и deps на :294):
   ```ts
   if (showForm || editingTask || showTeam || showReport || showUrgent) return;
   ```

---

## 5. Рефактор (опционально, но желательно): общий сборщик этапов

Сейчас логика «черновики этапов → `Stage[]`» и «ревью наследует лида архитектуры»
живёт внутри `TaskForm` (строки 25–96). Чтобы не копировать её в `UrgentTaskModal`,
вынести в `src/components/urgentStageDraft.ts` (или `stageDraft.ts`):

- `type StageDraft = { enabled; durationDays; assigneeId }`
- `defaultDrafts(): Record<StageType, StageDraft>`
- `draftsFromTask(task): Record<StageType, StageDraft>`
- `buildStages(drafts, opts?): Stage[]` — с правилом ревью и генерацией id.

`TaskForm` переключить на этот helper (поведение не меняется — рефактор без
регрессий, прогнать существующие тесты/линт). Если не хочется трогать `TaskForm`
сейчас — можно скопировать сборку в модалку и вынести позже; но общий helper
честнее и дешевле в поддержке.

---

## Крайние случаи и решения

- **Срочная не влезла в горизонт** (`qaEndIndex < 0`): `urgentUnplaced = true`,
  показываем предупреждение, «Применить» не блокируем (пользователь вправе всё
  равно внести — движок разместит по мере освобождения).
- **Этап без исполнителя**: разрешён (как в обычной форме) — учитывается по
  времени, но никого не занимает; в ударе не участвует. Это ок.
- **Дата старта — выходной**: нормализуем к ближайшему рабочему дню перед
  проставлением `pinnedStartDate` (иначе `dayToIndex.get` вернёт undefined и pin
  «провалится» в авторежим — не то поведение).
- **Завершённые задачи** в отчёте не показываем (у них `done`, релиз заморожен) —
  фильтровать `rows` по `!b.done`, чтобы «кого задело» = только живые задачи.
- **Пустой план / нет сотрудников**: `rows` пуст, плашка «никого не задело».
- **Производительность**: два `schedule()` по 260 дней на каждый ввод. Порядок
  как у основного `useMemo(schedule)` — приемлемо; при желании обернуть в `useMemo`
  по сериализованному `urgent`.

## Проверка (Acceptance → как убедимся)

- Ввёл дату старта + оценки → таблица затронутых со сдвигом в рабочих днях, план
  цел. → e2e в превью + юнит-тесты `urgentImpact`.
- Для каждой затронутой ясно «уедет вправо / на сколько». → карточка отчёта.
- «Применить» = один Ctrl+Z; «Отмена» без следов. → проверить undo-стек и что
  `autosave` не сработал при отмене.
- Удар считается по всем этапам (лид через архитектуру/ревью, QA через свой этап),
  не только по разработке. → тест «удар через лида».

## Порядок работ

1. `urgentImpact.ts` + тесты (движок в изоляции, без UI) — `npm test` зелёный.
2. Рефактор сборки этапов в общий helper, `TaskForm` на него.
3. `UrgentTaskModal.tsx` (форма → живой отчёт).
4. Интеграция в `App.tsx` (кнопка, рендер, hotkey-guard).
5. Прогон `npm test` / `npm run build` / `npm run lint`, e2e в превью.
6. Запись в `releasenote.md` при деплое (скилл `deploy-prod`).

## Открытый вопрос — решён

Как задавать «срочность»: `pinnedStartDate` первого этапа **+** `priority = 0`.
Pin фиксирует старт («начинаем такого-то числа» — буквальный смысл), приоритет 0
гарантирует, что при конфликте за человека движок ставит срочную раньше
остальных. Это соответствует рекомендации в БЛ-17.
