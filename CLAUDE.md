# resource-planner — шпаргалка для Claude

Планировщик ресурсов команды разработки: гант по сотрудникам, авторазмещение этапов задач, даты релизов, шаринг плана по ссылке. React 19 + TypeScript + Vite + Tailwind 4, тесты — Vitest. Git-репозиторий, ветка `main`, публикуется на GitHub (rdplanner). Продуктовые правила зафиксированы в `resource-planner-PRD.md`.

## Команды

- `npm run dev` — дев-сервер, порт 5173 (для превью есть `.claude/launch.json`, конфигурация `dev`)
- `npm test` — Vitest (покрыт только движок: scheduler + dates)
- `npm run build` — `tsc -b && vite build` → `dist/`
- `npm run lint` — ESLint

## Деплой на прод

Проект привязан к Vercel (`.vercel/project.json`, team dfs-projects-planning). По команде «задеплой на прод» — без лишних вопросов, по скиллу `deploy-prod` (`.claude/skills/deploy-prod/SKILL.md`): тесты → сборка → `npx vercel --prod --yes` → проверка алиаса https://dist-rho-seven-68.vercel.app → запись изменений в `releasenote.md`.

## Доменная модель (src/types.ts)

- `AppData = { employees, tasks, horizonStart, horizonWeeks }` — весь стейт приложения, единый объект; любые изменения через `setData`, расписание пересчитывается `useMemo(() => schedule(data))`.
- `Task = { id, name, priority, stages[], done?, completedAt? }`. Приоритет: **меньше число = выше**, решает конфликты за человека.
- Завершение задачи (`src/engine/complete.ts`): `completeTask` ставит `done` и замораживает этапы — закрепляет их на текущих рассчитанных датах, чтобы история не ездила. На ганте — серый блок «✓», не таскается; в таблице — свёрнутая секция «Завершённые» (вернуть в работу / удалить). Завершённые продолжают занимать людей, но исключены из CSV/.md-экспортов и предупреждений; их закреплённые этапы, уехавшие за начало горизонта, выпадают из расчёта («прошлое не воскресает»).
- Этапы строго последовательны: `architecture → development → review → qa` (у задачи может быть подмножество). `Stage = { id, type, durationDays, assigneeId, pinnedStartDate? }`.
- Специализации: `lead | backend | frontend | qa`. Кто что может (`src/roles.ts`): architecture и review — только lead; qa — только qa; development — backend/frontend/lead.
- Время — только рабочие дни пн–пт, даты — строки `YYYY-MM-DD` (без Date в стейте, чтобы не зависеть от таймзоны). `Employee.unavailable` — диапазоны отпусков/больничных.

## Движок (src/engine/scheduler.ts)

- Пользователь решает КТО (`assigneeId`), движок — только КОГДА.
- Жадное размещение по приоритету: человек занят максимум одним этапом в день, этап кладётся непрерывным блоком в ближайший свободный слот; недоступные дни исключаются.
- Два прохода: сначала резервируются закреплённые вручную этапы (`pinnedStartDate`), потом авторазмещение обтекает их. Наложения закреплённых = перегрузка (показывается красным).
- Расчётный горизонт — 260 рабочих дней (не путать с видимым `horizonWeeks`): не влезло в видимый — релиз едет вправо, этап не теряется.
- Дата релиза = ближайший **вт или чт строго после** окончания QA (`nextReleaseDay` в dates.ts).
- Этап без исполнителя учитывается по времени, но не занимает ничью загрузку (warning).
- `occupancy: employeeId -> dayIndex -> stageId[]` — >1 элемента = перегрузка (`overloadedDays`).

## Карта файлов

- `src/App.tsx` — корневой компонент: весь стейт, тулбар (горизонт, сохранить/загрузить/поделиться), undo/redo (стеки снимков `data`, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), таблица «Задачи и даты релизов», режим read-only при `?plan=...`
- `src/components/GanttChart.tsx` — гант: строки сотрудников по специализациям, interval-раскладка пересекающихся этапов по дорожкам, drag&drop (бросок = закрепление `pinnedStartDate`, двойной клик — открепить, Alt+двойной клик — открыть задачу на редактирование), маркеры «сегодня» и релизов 🚀, проп `showReleases`. Константы: CELL=34px, NAME_W=200, LANE_H=24
- `src/components/TaskForm.tsx` — модалка создания/редактирования задачи (этапы, длительности, исполнители из `assigneePool`)
- `src/components/EmployeeManager.tsx` — модалка сотрудников (добавление, специализация, недоступность)
- `src/components/stageStyle.ts` — цвета этапов (indigo/sky/amber/emerald) и приоритетов
- `src/engine/complete.ts` — завершение задачи (заморозка этапов) и возврат в работу
- `src/engine/dates.ts` — рабочие дни, parseISO/formatISO, nextReleaseDay (вт/чт)
- `src/data/sampleData.ts` — демо-данные (кнопка «Демо»)
- `api/save.ts`, `api/load.ts` — serverless-функции Vercel для шаринга, Upstash Redis (env: `KV_REST_API_URL/TOKEN` или `UPSTASH_REDIS_REST_*`), ключи `plan:{id}`

## Хранение

- Автосейв всего `AppData` в localStorage (`resource-planner:data`) при каждом изменении; сохранение/загрузка в файл — File System Access API (Chrome/Edge) с фолбэком на скачивание/`<input type=file>`. Формат файла: `{ version: SCHEMA_VERSION, data }`.
- Шаринг: «Поделиться» публикует план через `/api/save`, id запоминается в localStorage (`resource-planner:shareId`) — повторная публикация перезаписывает тот же план, ссылка постоянная. Открытие `?plan=id` → режим только-чтение.
- Настройки вида — личные предпочтения зрителя, хранить в localStorage отдельными ключами, **не в AppData** (она уходит в файл и в общую ссылку). Пример: `resource-planner:show-releases` — чекбокс «🚀 Релизы на ганте» в легенде.

## Договорённости

- Комментарии в коде — на русском, в стиле существующих
- Перед деплоем всегда прогонять тесты и сборку локально
- Изменения логики планирования — сразу с тестами в `src/engine/*.test.ts`
