# Admin cleanup: roles, single sources of truth, navigation, stability

Status: **proposed** · 2026-11-08 · base: `feat/launch-readiness` @ `6dffabfd`
Evidence: [UX/duplication audit](2026-11-08-admin-audit-ux.md) (RU) and
[stability/depth audit](2026-11-08-admin-audit-stability.md) (EN). File:line references are as of
`6dffabfd`; screenshot paths in the audits (`/tmp/admin-audit/…`) are machine-local and may be gone —
the code references are authoritative.

## Кратко (для владельца)

Админка стабильная (40 страниц без единой ошибки) и функционально глубокая для спортклуба, но
перегружена и местами противоречит сама себе: 26 пунктов меню, одна задача живёт в 2–5 местах, числа
между страницами не сходятся, главный тренер имеет доступ к деньгам и системным настройкам. Эта
спецификация: 1) разводит роли, 2) оставляет каждой задаче и каждой метрике одно место,
3) сокращает меню до 11 пунктов, 4) чистит страницы, 5) закрывает технические риски.
Новые бизнес-модули (касса, скидки, зарплаты, лиды, SMS) — только в бэклоге, раздел 9, по решению
владельца.

## Goal / non-goals

**Goal.** An owner can run a club from the admin where every job lives in exactly one place, every
number has one definition, each role sees only what it is responsible for, and nothing fails or loses
data silently.

**Non-goals.**
- New business modules (section 9) — not without an explicit owner decision.
- Mobile redesign. Mobile changes only where an endpoint or role rule it consumes changes.
- Visual rebrand. Keep the existing component library and theme.

## Ground rules for the implementer

- `CLAUDE.md` and `docs/conventions.md` are authoritative. Read the section for the area you touch
  and copy the nearest sibling. Key points: never commit to `main`; run `git branch --show-current`
  before every commit; squash-merge PRs; no AI attribution; `prisma db push` only (no `migrations/`,
  data moves go through `deploy/update.sh` `migrations()`); authorize **in the handler** via
  `RbacService` (owner has no `WorkspaceMember` row); `serialize*` DTOs; typed errors; unique
  controller-method and DTO names.
- **Commands.** Node from nvm if Homebrew node is broken
  (`PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`). Tests:
  `npx nx test @clubspace/<server|admin|mobile|client|video-worker|api-client> -- <substr>`.
  Typecheck: `tsc -p apps/server/tsconfig.app.json`, `apps/admin/tsconfig.json`,
  `apps/mobile/tsconfig.app.json`, `apps/client/tsconfig.json`. Contract after endpoint/DTO changes:
  `npx nx run @clubspace/server:open-api:generate && npx nx run @clubspace/api-client:types:generate && npx tsc -p libs/api-client/tsconfig.lib.json`
  and commit `open-api.json` + `libs/api-client/src/openapi/*`. Full gate: `npm run verify`.
- **One workstream = one branch = one PR** (section 7). Clean cutover: migrate every caller, remove
  obsolete code, keep only URL redirects for old admin routes.
- **Tests:** behavioural (permissions, boundaries, counts, transitions). Delete tests that pin
  removed wording. No tests of wiring or copy.
- **Local stack / demo data:** club ACADEMY `c851fd8a-0b45-4917-9f26-54aa80a87317`; accounts
  `owner@academy.demo`, `admin@academy.demo`, `coach@academy.demo` (role `head_coach`),
  `bjj@academy.demo` (direction manager), `student@academy.demo`; plain coach: `pedagog@ritm.demo`
  (club «Ритм»). Demo accounts sign in with `DEMO_LOGIN_CODE` from `.env` after
  `POST /send-auth-code`. Never run «Сбросить демо-клуб» locally (wipes uploaded videos).
- **UI rules** (apply on every page you touch):
  - one filled (primary) button per view; row tap = open/edit; at most one trailing icon or «⋯»
    per row; destructive actions inside «⋯» or the detail screen;
  - create/edit forms open in a side panel or dialog, not permanently expanded above lists;
  - a block renders only when its condition is true (no «Без активных отмен», no empty checklists);
  - sentence-case headings, no tracked UPPERCASE labels, no emoji as icons (colour dot instead);
  - Russian copy, formal «вы», correct plurals (`pluralRu`), no English/enum leaks
    (`adult / kids`, field names, IDs) in the UI;
  - same entity → same name everywhere (sidebar label = page title = breadcrumb).
- **Per-PR verification:** tsc for touched apps, targeted + full tests, the admin smoke crawl from
  F4 (once it exists) for owner/admin/head_coach/coach, and before/after screenshots of touched
  pages in the PR description.

---

## 1. Roles and permissions (P0) — workstream A

**Problem.** `head_coach` is a workspace admin: server `WORKSPACE_ADMINS = ['admin','head_coach']`
(`apps/server/src/shared/decorators/roles.decorator.ts:25`), client `ADMINS`
(`apps/admin/src/shared/lib/permissions.ts:23`). The head coach (sport role) therefore sees and
changes ЮKassa/Stripe keys (`payment-settings.controller.ts:59`), makes refunds
(`payments.controller.ts:68`), sees what the club pays ClubSpace («Тариф»), runs club import
(`club-import.controller.ts:69`) and edits system settings. A plain coach sees the revenue forecast,
a comparison with other coaches and the audit log. The audit page claims «Только владелец видит этот
раздел» (`ws/audit/page.tsx:98`) while the server allows all `STAFF_ROLES`
(`list-audit-events.controller.ts:34`). `WORKSPACE_ADMINS` is used in 46 server files and
`isWorkspaceAdmin` in 12 admin files.

**Target matrix.** Owner always passes (existing bypass). «Scoped» = existing direction/group scope
(`resolveCoachScope`, direction managers).

| Capability | owner / admin | head_coach | direction manager | coach |
|---|---|---|---|---|
| Payment provider keys, refunds, online-payments list | ✅ | ❌ | ❌ | ❌ |
| Tariff/price create, edit, archive | ✅ | ❌ | ❌ | ❌ |
| Assign abonement to a member, mark cash/transfer payment, freezes | ✅ | ✅ (default — open question Q1) | scoped | ❌ |
| ClubSpace subscription («Тариф» → «Подписка ClubSpace») | ✅ | ❌ | ❌ | ❌ |
| Revenue widgets, revenue forecast, revenue CSV | ✅ | ❌ | ❌ | ❌ |
| Settings (sections, coach permissions, booking rules, time zone, notifications), roles, public page, integrations / MCP & AI tokens, club import, data exports, audit log | ✅ | ❌ | ❌ | ❌ |
| Groups, gyms, schedule edits, substitutions, cancellations | ✅ | ✅ | scoped | own groups (existing rules) |
| Ranks ladders, gradings, courses & videos, announcements, events | ✅ | ✅ | scoped | existing rules |
| Call list / renewals, cohorts, occupancy | ✅ whole club | ✅ whole club | scoped | own groups |
| Coaches comparison | ✅ | ✅ | ❌ | ❌ |
| AI assistant | ✅ | only if its tools respect the money tier (verify `features/ai-chat`, MCP tools), else ❌ | ❌ | ❌ |

**Change.**
1. Server: replace the single admin tier with two explicit tiers, e.g. `CLUB_ADMINS = ['admin']`
   (money + system) and `SPORT_LEADS = ['admin', 'head_coach']` (sport/ops). Split
   `assertWorkspaceAdmin` into `assertClubAdmin` / `assertSportLead`. Classify every route that uses
   `WORKSPACE_ADMINS` (`grep -rl WORKSPACE_ADMINS apps/server/src`) by the matrix and record the
   classification table in this doc's PR. Update `shared/access/route-tier-consistency.spec.ts` so
   it pairs each assert with its `@Roles` tier. Audit list → `CLUB_ADMINS`; forecast & revenue →
   `CLUB_ADMINS`; coaches comparison → `SPORT_LEADS`.
2. Admin client: `permissions.ts` gets `isClubAdmin` / `isSportLead`; `visibleNavItems` and page
   guards use them. Pages a role can't use don't render in the sidebar (no disabled teasers).
3. Mobile: align role checks with the matrix — `features/schedule/substitution-helpers.ts:27`,
   `features/invite/invite-access.ts:12`, `features/profile/SettingsScreen.tsx:544`,
   `features/home/home-helpers.ts:187` (check what each gates).
4. Audit page text: «Видят владелец и администраторы».
5. Demo data and docs: `domains/demo/*catalog*` roles still make sense; update `docs/demo.md` and
   `docs/design/2026-11-01-direction-managers.md` if tiers are described there.

**Acceptance.**
- `coach@academy.demo` (head_coach): sidebar has no money/system items; direct API calls to refund,
  payment settings, billing, plan create, settings, import, exports, audit list return 403.
- `admin@academy.demo` and the owner: unchanged.
- Plain coach: Сегодня, Расписание, Ученики (own), Удержание (own) only.
- Handler specs: one per category (refund, payment settings, billing, plan create, settings,
  import, audit) — head_coach 403, admin and owner pass.

## 2. Single sources of truth (P0) — workstream B

### B1. One «Кому позвонить» list
**Problem.** «Кто пропадает» (`ws/retention`, live rules `domains/retention/load-workspace-risk.ts`,
`GET at-risk-members`) and «Кому позвонить» (`ws/analytics/churn`, nightly snapshot,
`features/club-analytics/list-churn-risk.handler.ts`) have the same subtitle and the same «Связались»
action (`logAtRiskContact`) but disagree: 58 vs 30 people, overlap 28. The dashboard tile
(`ws/page.tsx:276-283`), mobile coach home and mobile call list (`apps/mobile/src/features/retention/*`,
`features/home/HomeScreen.tsx`, `features/progress/ProgressScreen.tsx`) use `at-risk-members`.

**Change.** One server model, one endpoint, one list, used by: admin page, dashboard tile, mobile
coach home card, mobile call list.
- Recommended: membership and reasons from the **live rule engine** (a member whose abonement ended
  this morning must appear today); churn score and «₽ на кону» joined from the nightly snapshot by
  `userId` (absent → no score, still listed). The implementer may choose otherwise only if they
  write the reason into this doc. Hard requirements: one count everywhere; a logged contact hides
  the member immediately on every surface; filters gym / direction / group / coach + reason chips
  (Абонемент кончился · Новичок · Давно не был · Ходит реже); paginated; coach scope preserved.
- Cache the per-workspace computation ~60 s (client polls every 60 s, `apps/admin/src/shared/lib/at-risk.ts:28`).
- Delete the losing endpoint, its handler, client wrappers and the `/retention` page (redirect to
  the new location, section 3).

**Acceptance.** Demo club: the same number on the admin list header, dashboard tile and mobile coach
home; marking «Связались» drops the count by one on all of them without reload beyond the existing
realtime/poll.

### B2. Metric glossary — one name, one formula, one number
**Problem.** Students: 315 (dashboard) / 313 (forecast) / 325 (members) / 293 (billing) / 283
(«Активны за месяц»). Money per month: 1 178 900 (regular income) / 1 093 800 (revenue 30 days) /
1 341 735 (forecast average spend). «Активные абонементы 347» exceeds students. «Активны за месяц
283» and «Уникальных за месяц 283» are the same metric twice.

**Change.**
- Add a glossary table to this doc (metric id · Russian label · exact definition · server function).
  Minimum set: members total, active students (the billing definition: attended or opened the app in
  the last 30 days — `docs/legal`/landing FAQ), students with a current abonement, regular monthly
  income, revenue last 30 days, expected revenue 30/90 days, renewals due, awaiting payment.
- One server module computes each metric (e.g. `apps/server/src/domains/metrics/`); dashboard
  (`get-workspace-stats`), forecast, billing and members endpoints call it. Count people, not
  abonements, wherever the label says «ученики».
- Every UI label maps to exactly one glossary id; remove the duplicate tile; where two numbers
  legitimately differ, their labels must say why (e.g. «Выручка за 30 дней» vs «Ожидается за 30 дней»).

**Acceptance.** Each glossary metric shows the identical value on every screen that displays it
(checked by the smoke crawl or a server spec computing all surfaces from the same fixture).

### B3. Renewals in one place; one visible expiry
**Problem.** Renewals appear in 5 places: dashboard tiles («К продлению», «Доступ истекает»,
«Доступ закончился», «Неактивны»), «Кому продать абонемент» and «Ожидают оплаты» on the tariffs page,
member filters, the «Абонемент кончился» chip, the announcements audience «Только на продление»
(`features/manage-announcements/renewal-segment.ts`). Members have two expiries: `accessUntil`
(`schema.prisma:1147`, app access) and the abonement end; the members list has a date editor +
Сохранить + Бессрочно + Удалить in every row (`ws/users/page.tsx:726-779`).

**Change.**
- One «Продлить» list as a tab next to «Кому позвонить» (section 3), backed by
  `renewal-candidates` (paginate it). Remove both lists from the tariffs page. Dashboard: one tile
  linking to the tab. Member filters stay (they are queries) but use the same definitions. The
  announcement segment uses the same function as the list.
- Keep the `accessUntil` column (it drives app/video access and freezes, see `schema.prisma:2076-2103`).
  Remove the per-row editor from the members list. In the member card show «Доступ к приложению до»
  only when it differs from the current abonement end, with the manual override there.

### B4. Schedule edited in one place
**Problem.** Group time slots and cancellations are edited on the groups list, the group page and the
calendar (`features/schedule/calendar/ScheduleCalendar.tsx:6-20`); the gym page repeats schedules and
rosters read-only. The groups page is 10 953 px tall with 599 buttons (every group expanded with
student chips, slots with «Удалить», «Отмены и отпуска»).

**Change.**
- The calendar («Расписание») is the only editor of time: slots, one-off moves, cancellations,
  group vacations. If any of these exist only on the groups pages today, move them into the
  calendar first.
- «Группы и залы»: compact rows (name · gym · coach · N students · days) → group card with roster,
  coach, gym, capacity, booking mode; the card shows the schedule read-only with «Изменить в
  расписании» deep-linking to the calendar filtered by the group. Gyms get their own tab; the gym
  card shows address/settings and a read-only list of groups (no duplicated rosters).
- Pairs with F1/F2 (slim groups endpoint, server-side student search).

**Acceptance.** Groups page with the demo club (21 groups) fits in ~2 screens; no slot/cancellation
controls outside the calendar.

### B5. Smaller merges
- «Ранги» + «Аттестации» → «Пояса» with tabs «Аттестации» (default) · «Лестницы». Remove «Присвоить
  участникам» from the ladders page (bulk promotion lives in gradings, single grant in the member card).
- Remove the dashboard «Последние действия» (duplicates «История изменений», `ws/page.tsx:410-414`).
- Remove the analytics hub (`ws/analytics`, duplicates the submenu; header link
  `workspace-sidebar.tsx:321-326`); move the weekly-digest toggle to Settings → Уведомления.
- «Курсы и видео» is already the single home (`ws/videos` redirects to `ws/content`); point the
  remaining links straight at `/content` (`ws/page.tsx:471,534`, `videos/[videoId]/page.tsx:419`).

## 3. Navigation (P1) — workstream C

**Problem.** 26 sidebar items for the owner (`ws/workspace-sidebar.tsx:74-232`), 7 below the fold at
1440×900; group «Управление» has 18 mixed items; «Импорт клуба» is second, «Тариф» last; naming
collisions («Тариф» vs «Тарифы и абонементы»; page «Онлайн-оплата» vs billing module «Онлайн-оплата»;
«Удержание» next to «Кто пропадает»; «Интеграции» = one integration).

**Target (owner/admin).**

```
Каждый день
  1. Сегодня            бывший «Обзор»: по исключениям — позвонить (N), продлить (N), должники (N),
                        заявки (вступление + заморозки), тренировки сегодня, выручка месяца с трендом
  2. Расписание         бывшие «Тренировки»: календарь, отметки, замены, отмены — единственный
                        редактор времени
  3. Ученики            список первым; «Пригласить» — кнопкой (панель с кодом/QR); «⋯ → Импорт»;
                        фильтры Должники / Кончается абонемент / Неактивны
  4. Удержание          вкладки «Позвонить» (B1) · «Продлить» (B3)
Деньги
  5. Абонементы         цены и тарифы + вкладка «Платежи» (сейчас — онлайн-платежи; общий журнал —
                        бэклог E1)
  6. Отчёты             Выручка и прогноз · Загрузка залов · Тренеры · Когорты новичков ·
                        Выгрузка CSV · «Спросить ИИ»
Клуб
  7. Группы и залы      вкладки Группы · Залы
  8. Пояса              Аттестации · Лестницы            (если раздел рангов включён)
  9. Курсы и видео                                       (если видео включено)
 10. Новости и события  Объявления · События
Система (внизу)
 11. Настройки          Профиль клуба (бывшие «Публичная страница» + «О клубе») · Направления ·
                        Права тренеров · Запись · Приложение учеников (разделы, достижения) ·
                        Оплата (ЮKassa/Stripe) · Интеграции (MCP, ИИ-токены) · Уведомления ·
                        История изменений
     Меню аккаунта      Подписка ClubSpace (бывший «Тариф») · Мой профиль · Сменить клуб · Выйти
```

Role visibility follows section 1: head_coach — 1–4, 7–10; direction manager — same, scoped; coach —
1–4 scoped.

**Change.**
- Implement the IA above; titles = sidebar labels.
- Old routes keep working via redirects (`ws/retention`, `ws/analytics`, `ws/analytics/churn`,
  `ws/ranks`, `ws/gradings`, `ws/payments`, `ws/billing`, `ws/achievements`, `ws/integrations`,
  `ws/public-page`, `ws/audit`, `ws/club-import`, `ws/schedule` if renamed, `ws/videos`). Grep server
  notification/email templates and mobile deep links for admin URLs and update them.
- Settings: one «Профиль клуба» form (one save), keep section toggles only for optional modules
  (video, ranks, achievements, journal, events, guest visits…); core sections (Абонемент, Расписание,
  Посещаемость) stop being toggles only if no club relies on switching them off — check usage in the
  DB and `docs/club-setup.md` first; otherwise keep but move to an «Дополнительно» group.
- «Мой профиль» moves from the members page to the account menu.

**Acceptance.** Owner sidebar ≤ 12 top-level items, all visible at 1440×900; every old URL redirects;
no two items share a name stem that means different things.

## 4. Page-level cleanup (P1) — workstream D

Apply the UI rules to each page. Concrete targets (evidence in the UX audit, section 4):

| Page | Change |
|---|---|
| Сегодня (dashboard, `ws/page.tsx`, 3 770 px, 25 equal tiles) | Exceptions first (5–6 «нужно решение» rows), one revenue block with trend, today's classes. Remove video stats, top lists with 🥇, audit feed, duplicate tiles. Onboarding checklist (`features/billing/OnboardingChecklist.tsx:75`) gets «Скрыть»; optional steps (payments) never block completion |
| Ученики (`ws/users/page.tsx`) | List first; invite/QR in a panel; row = name · abonement/remaining · debt; tap → card; delete in the card; no video progress and no «Активен · Ученик» tautology in rows |
| Абонементы (`ws/subscriptions`) | Tariffs first; «Добавить тариф» → panel; people lists moved to Удержание/Ученики (B3) |
| Группы и залы | B4 |
| Расписание (calendar) | Evening blocks unreadable when >3 parallel classes → list or rows by gym; remove «Год» view |
| Пояса, Достижения, Направления, Объявления, Курсы | Row tap → editor; per-row Edit/Delete/▲▼/Выключить into «⋯»; create forms in panels; «Здесь уже есть достижения…» notice + dead button removed |
| История изменений | Human labels instead of slugs/IDs/English field names («slug: kimura», «Добавлено видео: d3071fb0…», «Поля: title») |
| Copy | «6 группа(ы)» (`ws/groups/page.tsx:171,350`) → plurals; «сможешь» → «сможете»; «Аудитория (adult / kids)» (`ws/ranks/page.tsx:137`) → Russian; emoji in directions/achievements/events/tops → colour dot or nothing; tracked uppercase labels → sentence case |
| Deletes | Shared `ConfirmDialog` stating consequences (e.g. «В группе 21 ученик…») instead of 49 `window.confirm` calls (F8) |

## 5. Correctness bugs (P0, small) — workstream E

1. **Expired abonements shown as «Активен» with «Отменить».** `features/subscriptions/MemberSubscriptionPanel.tsx:458-503`
   uses `statusLabel(s.status)` without dates and `canCancel && s.status === "ACTIVE"`. Derive a
   display state from status + dates (`Действует` · `Начнётся` · `Истёк` · `Заморожен` · `Отменён`);
   actions only on the current one. Prefer a server-computed field if other clients need it; check the
   mobile «Мой абонемент» for the same bug. Spec for the state helper.
2. **«Network Error» in English.** `apps/admin/src/shared/lib/error-message.ts:44-49`: with no
   `error.response` return «Нет связи с сервером. Проверьте интернет и повторите.»; update
   `features/consent/ConsentGate.spec.tsx:156-160`.
3. **Audit page claim** — fixed in A.
4. **Rows not links.** `features/content/VideoList.tsx:222`, `features/content/CourseList.tsx:44`
   use `router.push`; switch to `<Link>` rows (open in new tab, crawlable).

## 6. Stability and performance (P1, P2) — workstream F

| # | Item | Evidence | Change | Pri |
|---|---|---|---|---|
| F1 | `GET /groups` returns every group with full roster + user, unpaginated; admin loads it on 12 pages for dropdowns (84 KB at 325 members) | `features/list-groups/schemas.ts:88-91`, `list-groups.handler.ts:41`; 11 admin files call `listGroups` | Slim list (id, name, gym, direction, coach, memberCount); roster via `GET groups/:id/members` (paginated, `q`). Migrate every caller | P1 |
| F2 | Groups page downloads the whole member list for a picker (`listAllWorkspaceMembers`, 319 KB page total) | `apps/admin/src/shared/api/members.ts:71-82`, `groups/page.tsx:103-107` | Server-side search combobox (`q` exists on members list); remove `listAllWorkspaceMembers` if no caller remains | P1 |
| F3 | «Пересчитать» analytics refresh: synchronous whole-club recompute, no throttle, no lock | `club-analytics.controller.ts:168-184`, `refresh-analytics.handler.ts:22-36`, `analytics-snapshot.service.ts:53-55` | Skip if fresher than N minutes; BullMQ single-flight job per workspace; 202 + realtime «updated»; `@Throttle` | P1 |
| F4 | No admin e2e; 65 route files at 0% coverage | `npx nx test @clubspace/admin --coverage` → 30.35/26.36/23.37/29.03 | **Do first.** Playwright smoke project (e.g. `apps/admin-e2e`): sign in as owner, admin, head_coach, coach; visit every route (dynamic ids from the API); fail on console errors, 5xx, unexpected 4xx, error boundary, `undefined`/`NaN`/`Invalid Date` in text; assert role-forbidden routes are hidden/403. Wire into `scripts/verify.sh` behind a flag and into CI | P0 |
| F5 | No unsaved-changes guard (Settings edit lost on sidebar click; no `beforeunload` anywhere) | stability audit #5 | `useDirtyGuard`: `beforeunload` + intercept in-app navigation while dirty; use on settings, plans, events, announcements, video text, profile | P1 |
| F6 | Other unbounded endpoints: `at-risk-members` (54 KB, whole-club scoring per request), `rank-readiness` (75 KB), `renewal-candidates`, `events` (no max range), churn/cohorts filter in JS | `list-at-risk-members.handler.ts:68`, `list-renewal-candidates.handler.ts:47`, `list-workspace-events.feature.ts:7-10`, `domains/analytics/analytics-reports.ts:109-115` | Paginate or cap; filter in SQL; cache risk (B1) | P1 |
| F7 | Coverage ratchet stale (14/14/12/14 vs ~30/26/23/29) | `apps/admin/jest.config.cts` | Raise to ~29/25/22/28; add render tests for users, groups, subscriptions, payments pages | P1 |
| F8 | 49 native `window.confirm` | e.g. `directions/page.tsx:122`, `achievements/page.tsx:213` | Shared `ConfirmDialog` with consequences | P2 |
| F9 | Validation retyped by hand (admin never imports zod) | `create-plan.feature.ts:10-12` vs `subscriptions/page.tsx:189-199` | Share zod input schemas via a lib or derive limits from `open-api.json` | P2 |
| F10 | Concurrent edits: last write wins | no `updatedAt`/`If-Match` checks in update-group, plans, settings, announcements | Send `updatedAt`, return 409 when stale, show «Изменено другим пользователем» | P2 |
| F11 | No client cache: 7 bootstrap calls per page load, duplicates (`get-my-workspaces` 2–3×) | stability audit #11 | In-flight dedupe for bootstrap calls; TanStack Query optional | P2 |
| F12 | Video preview silently breaks when API `ROOT_URL` ≠ admin `NEXT_PUBLIC_API_URL` (CSP `media-src`) | stability audit #15 | Startup check or derive both from one setting | P2 |

## 7. Phasing and PR plan

| PR | Scope | Depends on | Size |
|---|---|---|---|
| 0 | F4 admin smoke e2e (+ F7 ratchet) — safety net for everything below | — | M |
| 1 | A roles & permissions (server tiers, admin, mobile checks, audit text) | 0 | M |
| 2 | E correctness bugs | — | S |
| 3 | B1 one call list (server, admin, mobile, dashboard tile) + F6 risk cache | 0 | M |
| 4 | B2 metric glossary | 0 | M |
| 5 | B3 renewals + `accessUntil` UI | 3, 4 | M |
| 6 | B4 schedule/groups split + F1 + F2 | 0 | L |
| 7 | C navigation + redirects + B5 | 1, 3, 5, 6 | M |
| 8 | D page cleanups (may split: dashboard+members, rest) | 7 | M–L |
| 9 | F3 + F5 + remaining F6 | — | M |
| 10 | P2 items (F8–F12) | — | M |

Each PR: update this doc's status/decisions, `CHANGELOG.md` (Unreleased), `docs/demo.md` if demo
flows change; reviewer pass before merge (`.claude/agents/README.md`, `cs-reviewer`).

## 8. Definition of done (whole spec)

- Owner sidebar ≤ 12 top-level items, all visible at 1440×900; every old URL redirects.
- head_coach has no money/system UI and gets 403 on those APIs; coach sees 4 items, scoped.
- One «Кому позвонить» count, identical on admin list, dashboard and mobile; one «Продлить» list.
- Glossary in this doc; each metric identical across screens.
- Group time edited only in the calendar; groups page ≤ ~2 screens for 21 groups.
- No expired abonement labelled «Активен»; no English «Network Error»; no `window.confirm` (if F8 done).
- Admin smoke e2e green for owner/admin/head_coach/coach in `verify.sh`/CI; coverage ratchet raised.
- tsc clean (server, admin, mobile, client); all tests green; contract in sync.

## 9. Backlog — business gaps (owner decision required; do not start without a go)

Checked in code (UX audit section 5, stability audit «Depth»). Recommended order:

| # | Capability | Now | Sketch | Size |
|---|---|---|---|---|
| E1 | Payments journal (cash + transfer + card + online in one list) and cash/partial refunds | Manual payments live on each subscription; only online payments are listed (`member-subscriptions.controller.ts`, `schema.prisma:1022-1028`); refunds only full online (`online-payments/refund-payment.handler.ts`) | Read-only journal over existing records first (cheap), then refund records for cash/partial | S → M |
| E2 | Member autopay / recurring abonements | Autopay exists only for club → ClubSpace (`platform-autopay.processor.ts`) | Saved card via ЮKassa recurring per club shop; renewal job; opt-in per tariff | L |
| E3 | Discounts, promo codes, family/sibling pricing | `Plan` has only `price` (`schema.prisma:2075+`); a demo announcement promises «Скидка 5%» | Discount entity applied at assignment/checkout; audit; reports | M |
| E4 | Coach rates and payroll | Coach analytics already counts classes and students (`analytics/coaches`) | Rate per class/student/percent; monthly payroll report; export | M |
| E5 | Leads / trial requests pipeline | Join requests and a trial tariff exist; no lead list, source, status, reminders (`DemoRequest` is ClubSpace's own funnel) | Lead entity from public page/QR/manual; statuses; reminder; conversion to member | M |
| E6 | Requests inbox (join, freeze, personal training) | Freezes approved only inside a member card; personal-training requests not visible in admin at all (mobile only) | One «Заявки» list on Сегодня | S–M |
| E7 | SMS / WhatsApp, broadcast to debtors, direct message to a member | Channels: push, e-mail, Telegram (`schema.prisma:69-73`); no admin call to send a notification to a segment | Segment broadcast using existing announcement segments; SMS provider later | M |
| E8 | Expenses, P&L, cash desk | absent | Expense categories, monthly P&L with revenue from glossary | M–L |
| E9 | QR check-in at the door; birthday greetings; waiver/contract for minors | 6-digit self check-in code only; birthday event type declared without a source (`users-events.config.ts:30,44`); only PD consents | Small, independent | S each |

## 10. Open questions for the owner

1. **Q1.** May the head coach assign abonements and record cash payments (default in this spec: yes;
   prices, refunds and payment keys: no)?
2. Confirm the call-list engine choice in B1 (live rules + snapshot score).
3. Which section-9 items go first (recommended: E1 → E6 → E3 → E2)?
4. Remove the calendar «Год» view?
5. Should a plain coach use the admin web at all, or only the mobile app?
