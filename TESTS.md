# Тесты

## Команды

```bash
# Unit-тесты server, admin, mobile и video-worker разом (~20 сек).
# Перед мержем — `npm run verify` (typecheck, тесты с coverage, контракт, e2e, lint).
npm run test:all

# По проекту:
npm run test:server
npm run test:mobile

# В watch-режиме (живая обратная связь во время правок):
npm run test:watch:server
npm run test:watch:mobile

# С coverage-репортом (HTML в test-output/jest/coverage):
npm run test:coverage

# API e2e: поднимает AppModule целиком в процессе против настоящих Postgres и
# Redis (`npm run dev:infra`), сам создаёт базу `clubspace_e2e`:
npm run test:e2e

# Admin smoke e2e (Playwright): вход через UI за owner / admin / head_coach /
# coach, обход всех доступных страниц. Нужен запущенный API с демо-клубами,
# админку скрипт соберёт и поднимет сам — см. «Admin smoke e2e» ниже:
npm run test:admin-e2e
```

## Стек

- **Server unit:** Jest + `@swc/jest` (тот же транспайлер, что у `server-e2e`).
  Конфиг: `apps/server/jest.config.cts`.
- **Mobile unit:** Jest + `@swc/jest`. Без `jest-expo` — тестируем чистые
  TS-функции (date math, schedule helpers, VTT parser), а не RN-компоненты.
  Конфиг: `apps/mobile/jest.config.cjs`.
- **API e2e:** `apps/server-e2e` (Jest, настоящий AppModule + Postgres + Redis),
  61 spec-файл.
- **Admin:** Jest + Testing Library (jsdom), 70 spec-файлов.
- **Admin smoke e2e:** `apps/admin-e2e` (Playwright, Chromium), 4 роли.
- **Video worker:** Jest, 15 spec-файлов. **api-client:** Jest, 1 spec-файл.

## Что сейчас под покрытием

Счёт на 2026-11-08: server — 369 spec-файлов / 4466 тестов, admin — 70 / 493,
mobile — 100 / 1365, video-worker — 15 / 271, api-client — 1 / 7. Таблицы ниже —
примеры, а не полный список.

### Server

| Файл | Что проверяет |
|------|---------------|
| `manage-group-schedule/slot-utils.spec.ts` | `parseTimeToMinutes`, `slotsOverlap` (включая edge-case end-touch), `crossesMidnight` (включая 23:00–24:00 ровно). |
| `manage-group-schedule/schemas.spec.ts` | `isoDate`, `serializeSlot`, `serializeException` — формат отдачи дат на проводе. |
| `manage-group-schedule/slot-move-utils.spec.ts`, `move-group-occurrence.handler.spec.ts`, `split-group-slot.handler.spec.ts` | Перенос занятия: «Только это занятие» (разовое занятие + отмена-перенос, повторный перенос на месте, возврат на исходное место), «Это и все следующие» (на месте / разрез серии / слияние обратно), сдвиг записей, отказы по правам, прошедшему занятию и пересечению. |
| `get-workspace-schedule/date-utils.spec.ts` | `parseDateOnly`, `addDays`, `daysBetween`, `isoDayOfWeek` (Пн–Вс), `isoDateString`, `endOfDayUtc`. |
| `playlist/services/playlist-visibility.spec.ts` | Visibility-clauses: `isPublic + (publishedAt IS NULL OR <= NOW())` для студентов; пустой список для admin scope. |
| `shared/services/rbac.service.spec.ts` | `assertCanWriteGroup`: admin scope, primary, assistant, не-coach. |
| `domains/scheduler/reminders.service.spec.ts` | Напоминания за час: запрос только слотов окна по (день недели, время) в часовом поясе зала/клуба (21:30 Нью-Йорк в 00:30 UTC), переход через полночь, ledger-идемпотентность, отмены, события, анонсы. |
| `domains/scheduler/daily-club.service.spec.ts` | Ежедневный проход клуба в местное утро: неактивные по `lastAttendedAt`, истечение доступа, однократный backfill, отказ одного клуба не роняет остальные. |
| `domains/scheduler/data-purge.service.spec.ts` | Ночная очистка: старые уведомления пачками, ledger только для ограниченных по времени видов, истёкшие refresh-токены. |
| `domains/notifications/services/push-delivery.service.spec.ts` | Push-очередь: атомарный захват строк, пачки до 100 сообщений, ticket id вместо полного ответа Expo, повтор только временных ошибок, чистка токенов по receipts. |
| `features/send-email-notification/send-email-notification.processor.spec.ts` | Очередь писем (OTP): повтор при сбое SMTP, без повтора при отказе адресата. |
| `domains/audit/services/audit-naming.spec.ts` | Каждое значение `AuditAction` соответствует `<entity>.<camelCaseVerb>` — иначе сломается фильтр на странице аудита. |

### Mobile

| Файл | Что проверяет |
|------|---------------|
| `features/schedule/schedule-helpers.spec.ts` | `isoDayOfWeek`, `parseHHMM`, `formatDuration`, `formatSlotShort`, `findExceptionForSlot`, `findActiveGroupException`, `findNextSession` (со skipped today и cancellation), `formatNextSessionLabel` (Сегодня/Завтра/В среду), `isoDateString` без TZ-сдвигов. |
| `features/schedule/schedule-calendar.spec.ts` | Календарь расписания: день и минута в поясе занятия, разрезка занятия через полночь и многодневного события по дням, раскладка пересекающихся занятий в колонки (и расширение вправо), ось времени по самому раннему/позднему занятию, позиция блока и линии «сейчас», листание по неделям и загрузка окнами по две недели, состояние записи на блоке («11/12», «Мест нет · очередь 3», «Вы записаны», «лист ожидания №N»). |
| `features/video/subtitle-overlay.spec.ts` | `parseVtt` (минимальный cue, без часов, HTML-теги, NOTE-блоки) и `findActiveCue`. |

### Admin

| Файл | Что проверяет |
|------|---------------|
| `features/schedule/calendar/calendar-helpers.spec.ts` | Дни клуба без поясных сдвигов, недели с понедельника, сетка месяца, окна по 90 дней, русские подписи диапазонов, привязка к 15 минутам, раскладка пересекающихся занятий, пересечения по залу и тренеру. |
| `features/schedule/calendar/calendar-items.spec.ts` | Занятия и события на сетке, фильтры зал/направление/тренер/группа, «свои группы» тренера, скрытие отменённого оригинала переноса, «Замена: …», «11/12», колонки дня «По залам» (порядок залов клуба, «Без зала» последней, пустой зал — только без фильтров и если в нём есть группа зрителя). |
| `features/schedule/calendar/TimeGridView.spec.tsx`, `ScheduleCalendar.spec.tsx` | Блоки на линиях времени, перетаскивание и растягивание с шагом 15 минут, Escape, диалог «Только это / Все следующие» и отмена через тост, режим только чтения для тренера, переключение видов; день «По залам»: занятие в колонке своего зала во всю ширину, зал с параллельными занятиями шире, новое занятие в клетке зала предлагает только группы этого зала, перетаскивание над чужим залом меняет только время, переключатель «По залам / Общая» запоминается и не показывается в неделе. |

## Что добавить дальше

- **Admin Playwright, сценарии с действиями:** группы → добавить слот →
  сохранить и т. п. — поверх `apps/admin-e2e` (сейчас там только обход
  страниц без изменений данных).
- **Mobile component-level (jest-expo + @testing-library/react-native):**
  экраны (`*.tsx`) сейчас не покрыты — тестируются только helpers (`*.ts`,
  coverage-порог в `apps/mobile/jest.config.cjs`).
- **Client (`apps/client/specs`):** 4 spec-файла есть, но у проекта нет
  nx-цели `test`, поэтому они не запускаются ни в CI, ни в `verify`.

## Admin smoke e2e

`apps/admin-e2e` — Playwright-обход админки. Для каждой роли из
`src/role-matrix.ts` (owner `owner@academy.demo`, admin `admin@academy.demo`,
head_coach `coach@academy.demo`, coach `pedagog@ritm.demo`) тест входит через
настоящую форму входа (код `DEMO_LOGIN_CODE`), берёт маршруты из отрисованного
сайдбара и строк вкладок разделов (`[data-section-tabs]`: «Отчёты», «Абонементы»,
«Пояса», «Новости и события», разделы «Настроек» — найденная на странице вкладка
добавляется в обход), id для страниц-карточек (участник, группа, зал, курс, видео,
аттестация, тариф) — из API тем же аккаунтом, и открывает каждую страницу.
Страница падает, если на ней: ошибка в консоли, необработанное исключение,
ответ API 5xx или неожиданный 4xx, экран ошибки («Что-то пошло не так») или
404 Next, загрузка (скелетон, спиннер, «Загрузка…») дольше 15 с, текст
`undefined` / `NaN` / `Invalid Date` / `[object Object]`, уведомление «Раздел
доступен…» на странице из меню. Затем — таблица ролей: маршруты из `blocked`
не должны быть в сайдбаре и во вкладках и при прямом заходе должны отказывать
(уведомление или редирект; 403 от API там допустим), `offMenu` — нет в
сайдбаре, но открываются (меню аккаунта, разделы настроек). Под владельцем —
старые адреса из `LEGACY_REDIRECTS`: каждый должен привести на новый маршрут (с
сохранённым query). Данные клубов тест не меняет (остаются только записи о
входе).

Запуск:

```bash
# API: демо-режим (docs/demo.md), ADMIN_URL = адрес админки и он же в
# CORS_ORIGINS — сессия живёт в HttpOnly-cookie, которую API выдаёт только
# своей админке. Порт API — SERVER_PORT.
npm run test:admin-e2e                       # :4200 → API :3000
ADMIN_E2E_BASE_URL=http://localhost:4301 ADMIN_E2E_API_URL=http://localhost:3101 \
  npm run test:admin-e2e -- -g coach         # свои порты, одна роль
VERIFY_ADMIN_E2E=1 npm run verify            # как шаг verify
```

Если на адресе админки никто не отвечает, `run.sh` собирает её в production
(`nx build`, `NEXT_PUBLIC_API_URL` = адрес API) и поднимает standalone-сервер
(`.next/standalone/.../server.js`, как в Docker-образе; `next start` такие
сборки не запускает) из своей копии в `dist/admin-e2e/<порт>`; если отвечает
не админка — останавливается. Браузер: `npx playwright install chromium`
(версия `@playwright/test` закреплена — 1.65.1, Chromium 1255). Отчёт и
trace упавших тестов — `test-output/admin-e2e/`. Исключения (ожидаемые ошибки
консоли, известные дефекты с 4xx) — только списком в `src/checks.ts`, у
каждого причина; запись известного дефекта удаляется вместе с исправлением.

## Как добавить тест

1. Кладёшь `*.spec.ts` рядом с тестируемым файлом.
2. Импортируешь только публичный API (helpers/services). Не лезь в
   приватные внутренности handler-ов — выноси чистую логику в
   `*-utils.ts`/`*-helpers.ts`.
3. Для Prisma делаем минимальный stub:
   ```ts
   const prisma = {
     groupCoach: { findFirst: jest.fn().mockResolvedValue(null) },
   } as never
   ```
4. `npm run test:watch:server` — мгновенно увидишь как падает.
