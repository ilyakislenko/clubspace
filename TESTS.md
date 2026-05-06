# Тесты

## Команды

```bash
# Всё разом — server + mobile unit тесты, ~1 сек.
npm run test:all

# По проекту:
npm run test:server
npm run test:mobile

# В watch-режиме (живая обратная связь во время правок):
npm run test:watch:server
npm run test:watch:mobile

# С coverage-репортом (HTML в test-output/jest/coverage):
npm run test:coverage

# Существующий API e2e (требует запущенного сервера на :3000):
npm run test:e2e
```

## Стек

- **Server unit:** Jest + `@swc/jest` (тот же транспайлер, что у `server-e2e`).
  Конфиг: `apps/server/jest.config.cts`.
- **Mobile unit:** Jest + `@swc/jest`. Без `jest-expo` — тестируем чистые
  TS-функции (date math, schedule helpers, VTT parser), а не RN-компоненты.
  Конфиг: `apps/bjj-academy-mobile/jest.config.cjs`.
- **API e2e:** существующий `apps/server-e2e` (Jest + axios, бьёт по
  localhost:3000).

## Что сейчас под покрытием

### Server (76 тестов)

| Файл | Что проверяет |
|------|---------------|
| `manage-group-schedule/slot-utils.spec.ts` | `parseTimeToMinutes`, `slotsOverlap` (включая edge-case end-touch), `crossesMidnight` (включая 23:00–24:00 ровно). |
| `manage-group-schedule/schemas.spec.ts` | `isoDate`, `serializeSlot`, `serializeException` — формат отдачи дат на проводе. |
| `get-workspace-schedule/date-utils.spec.ts` | `parseDateOnly`, `addDays`, `daysBetween`, `isoDayOfWeek` (Пн–Вс), `isoDateString`, `endOfDayUtc`. |
| `playlist/services/playlist-visibility.spec.ts` | Visibility-clauses: `isPublic + (publishedAt IS NULL OR <= NOW())` для студентов; пустой список для admin scope. |
| `shared/services/rbac.service.spec.ts` | `assertCanWriteGroup`: admin scope, primary, assistant, не-coach. |
| `domains/scheduler/scheduler-tick.service.spec.ts` | Один тик: расщепление на сессии/ивенты/отмены, идемпотентность через ledger, окно 55–65 мин, скип отменённых сессий. |
| `domains/audit/services/audit-naming.spec.ts` | Каждое значение `AuditAction` соответствует `<entity>.<camelCaseVerb>` — иначе сломается фильтр на странице аудита. |

### Mobile (30 тестов)

| Файл | Что проверяет |
|------|---------------|
| `features/schedule/schedule-helpers.spec.ts` | `isoDayOfWeek`, `parseHHMM`, `formatDuration`, `formatSlotShort`, `findExceptionForSlot`, `findActiveGroupException`, `findNextSession` (со skipped today и cancellation), `formatNextSessionLabel` (Сегодня/Завтра/В среду), `isoDateString` без TZ-сдвигов. |
| `features/video/subtitle-overlay.spec.ts` | `parseVtt` (минимальный cue, без часов, HTML-теги, NOTE-блоки) и `findActiveCue`. |

## Что добавить дальше

- **Server e2e (apps/server-e2e):** полный flow «создать workspace → группу
  → слот → проекция возвращает occurrence в правильной TZ». Сейчас там
  только smoke `GET /api`. Расширить — отдельный PR.
- **Admin Playwright:** sign-in → дашборд, группы → добавить слот → сохранить.
  Сейчас пакет не установлен. Установить + scaffold — отдельный PR.
- **Mobile component-level (jest-expo + @testing-library/react-native):**
  ScheduleScreen с моком auth-context. Сейчас есть только helpers.

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
