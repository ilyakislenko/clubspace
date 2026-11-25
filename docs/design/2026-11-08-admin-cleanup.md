# Admin cleanup: roles, single sources of truth, navigation, stability

Status: **implemented** on `feat/admin-cleanup` (waves 1–6, 2026-11-14; section 9 backlog not part
of it) · 2026-11-08 · base: `feat/launch-readiness` @ `6dffabfd`
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
| Call list, cohorts, occupancy | ✅ whole club | ✅ whole club | scoped | own groups |
| Renewals («Продлить», «Ожидают оплаты») | ✅ | ✅ (row amounts = agreed price, operational) | ❌ | ❌ |
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

**Decisions (wave 1).**
- Tiers: `CLUB_ADMINS = ['admin']`, `SPORT_LEADS = ['admin','head_coach']`; `WORKSPACE_ADMINS` and
  `assertWorkspaceAdmin` removed. Owner = club admin always (AuthGuard now lifts an owner with a
  `head_coach` row to `admin`; the owner's row must stay `admin`; a platform owner transfer raises a
  head coach to `admin`).
- **CLUB_ADMINS** (pinned in `route-tier-consistency.spec.ts`): online payments list + refund, payment
  settings (4), ClubSpace billing (8), club import (6), exports (4), PATCH settings, public profile
  (3), PUT club-about, member role change, role list, directions CRUD + direction managers (6),
  onboarding help + checklist, club legal accept, audit list, revenue forecast, tariffs
  create/update/delete **and the tariff page GET** (it shows what a tariff earned), AI tokens (3).
- **SPORT_LEADS**: invite/add/approve/reject/remove members, access date, invitations, join code,
  dependents, member notes/profile, gyms CRUD, awaiting payment, renewal candidates, cancel
  abonement, unmark abonement/event payment, analytics refresh, **coaches comparison** (was all
  staff). Assign abonement / mark paid / freezes stay `COACHING_ROLES` (Q1 default).
- Staff are the club admins' call: inviting with a staff role, revoking a staff invitation,
  approving a pending staff row, removing, changing access of, or editing the profile (e-mail,
  phone, name) of coach/head coach/admin/owner needs a club admin (`assertCanManageRoles` covers
  every staff role).
- Money is stripped server-side for non-club-admins: dashboard `revenue`/`today.revenue`, churn
  `monthlySpend` and `summary.moneyAtStake` (now nullable), AI money tools and amount fields
  (`AiAccess.isClubAdmin`), the chat prompt's access line and the money suggestion. Dashboard
  `recentEvents` (audit rows) is empty below club admin. Weekly digest (has money) → owner +
  admins only (mobile toggle too).
- «Тарифы и абонементы» page opens to sport leads for the awaiting-payment and renewal lists;
  tariff management on it and the tariff page stay club-admin (until wave 3 moves the lists).
- Tariffs left the direction rule: direction managers no longer edit tariffs (matrix ❌).
- AI: tokens/MCP are club-admin only (a token stops working once its creator is not a club admin;
  `canRevoke` dropped from the DTO). The in-app chat stays open to head coaches and direction
  managers in their scope **without money tools** — matrix says ❌ for direction managers; kept
  because the scope code already limits them and money is gated. Owner may flip to ❌.
- Audit list: coach-narrowed feed removed (club admins see the whole feed).
- Admin nav access levels: staff (dashboard, retention, churn, users, schedule) · lead = sport lead
  or direction manager (groups, content, ranks, gradings, events, announcements, achievements,
  cohorts, occupancy, AI chat) · sportLead (coaches) · clubAdmin (import, directions, tariffs,
  payments, audit, public page, settings, integrations, billing, forecast). Gates: `ClubAdminGate`,
  `SportLeadGate`, `LeadGate`, denied text «Раздел доступен …».
- Mobile: only the digest toggle changed; substitution, join-request and coach-view helpers already
  match the matrix (sport leads / coaching roles).

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

**Decisions (wave 2, B1 + the F6 risk cache).**
- Model as recommended: `domains/retention/call-list.ts` `loadCallList` = the live engine
  (`loadWorkspaceRisk`: who and why) + the hourly snapshot joined by `userId` (`score`, `level`,
  `monthlySpend`, `currency`; no snapshot → `null`, still listed). Order: reason priority (lapsed,
  newcomer, absent, declining), then score, then the longest absence, then the name. The snapshot's
  score reasons are not sent (the live `factsText` explains the row).
- One endpoint: `GET workspaces/:id/at-risk-members` (kept: the contacts route lives there);
  `GET analytics/churn`, `ListChurnRisk*`, `loadChurnReport`, `CONTACT_FRESH_DAYS`,
  `CHURN_LIST_MIN_SCORE` and the admin `listChurnRisk`/`splitChurnList`/`CHURN_LEVEL_*` are deleted.
  Query: `gymId`/`directionId`/`groupId`/`coachId` (resolved by `resolveAnalyticsScope`, foreign id →
  404), `reason` (chip), `snoozed` (`true` = the contacted ones instead of the ones to call), `curPage`,
  `perPage` (50, max 200). Response: `data`, `summary` (`total` + per reason + `high` + `snoozed` +
  `moneyAtStake`, over scope and filters, not over the chip or the page), `total` (rows matching
  everything), `curPage`, `perPage`, `scoredAt` (renamed from `page` in the final review, to match
  every other paged endpoint).
- Scope = the matrix: sport leads the whole club (group-less members included), a coach or a
  direction manager the groups they act on as their own (`ownGroupsWhere`) **regardless of
  `coachSeesAllGroups`** — the old `scope=mine` parameter and the read-all coach's view of other
  coaches' students are gone, so the admin page and the app show a coach the same number. Every
  listed row is therefore callable: `canContact` is removed. Rows show only in-scope groups.
- Money stays club-admin only (`isClubAdmin`): `monthlySpend` and `summary.moneyAtStake` are `null`
  for head coaches and coaches.
- «Связались» = the existing snooze (14 days unless a new signal appears): a contacted member leaves
  `total` and the list on every surface and shows under `snoozed=true`.
- Cache: `CallListCacheService` (Redis `call-list:<workspaceId>`, the whole club's list as JSON,
  60 s TTL, same pattern as the leaderboard cache); `LogAtRiskContactHandler` drops it after writing;
  a computation that started before the drop does not store its result (`…:dropped` timestamp);
  Redis down → computed from the database. Check-ins and abonements rely on the TTL (the admin
  polls/refreshes at most once a minute anyway).
- The Monday «Аналитика за неделю» reads the same list (`loadCallList`): «N под риском» = the open
  count, «Позвоните сегодня» = the first three, the renewal action counts `lapsed` («абонемент
  закончился»); both actions link to `retention`.
- Admin: `ws/retention` is the one page, titled «Кому позвонить» (sidebar label, dashboard tile and
  the AI answer use the same name): header «N учеников стоит позвонить · с высоким риском — N · на
  кону …» (money for club admins), the analytics filters, reason chips with counts, «Связались
  недавно (N)» switch, a «Риск» column, «Показать ещё». `ws/analytics/churn` redirects there; the
  churn card left «Аналитика»; the sidebar group «Аналитика» is hidden when a role has no item in it
  (a plain coach). The dashboard tile reads the summary with `perPage=1`. *Superseded in wave 4:*
  the sidebar item is «Удержание» with tabs «Позвонить» · «Продлить»; the «Аналитика» group is gone.
- Mobile: the home and «Прогресс» cards read `atrisk:<ws>:summary` (`perPage=1`); «Кому позвонить»
  pages its own keys per view (`atrisk:<ws>:open|snoozed:<reason>`), chips filter on the server,
  «Связались» removes the row, moves every count (`applyContact`) and invalidates `atrisk:<ws>` so
  the home card refetches.
- Smoke (local DB, ACADEMY): owner, admin and head coach 250 on list / tile / app keys (the demo data
  has aged since it was generated; the live engine counts every absence), direction manager 209,
  Ритм coach 20; one «Связались» → 249 / 249 / 249 everywhere (the BJJ manager stays 209: not his
  group), the coach 20 → 19. First read ~180 ms, cached ~15 ms.

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

**Glossary.** «Ученик» everywhere = `studentWhere` (`domains/metrics/students.ts`): an `ACTIVE`
membership with the role `user` (children included), never the owner or staff. People counts are
over the caller's scope (a coach: own groups; the forecast: its filters). Functions live in
`apps/server/src/domains/metrics/` unless another module is named.

| Metric id | Russian label | Definition | Server function | Shown on |
|---|---|---|---|---|
| `members_total` | «Участники (N)» | every membership but pending invitations (students, staff, the owner's row, suspended/blocked) | `memberRosterWhere` | members list header |
| `students_total` | «Ученики» | students | `countStudents` | dashboard «Посещаемость» (the share base), «Прогноз выручки» card subtitle, weekly digest, AI `club_overview` |
| `students_active` | «Активные ученики» | students with `lastAttendedAt` or `lastSeenAt` (opened the club in the app) within 30 days — what the club pays ClubSpace by | `countActiveStudents`, `countActiveStudentsMany` | «Тариф» (bill, tier), platform console, AI; stats API (not drawn on the dashboard since wave 5) |
| `students_with_abonement` | «Ученики с абонементом» | students holding ≥ 1 current abonement (`currentSubscriptionWhere`; paid or not); people, not abonements | `countStudentsWithAbonement` | AI; stats API (not drawn on the dashboard since wave 5) |
| `students_attended_7d` / `_30d` | «Были на занятиях за неделю / за 30 дней» | students with ≥ 1 check-in in the window | `countStudentsAttended` | dashboard «Посещаемость» |
| `students_not_attended_30d` | «Не были на занятиях 30 дней» | students without a check-in in 30 days (never-attended included); = `students_total − students_attended_30d` | `notAttendedWhere`, `countStudentsNotAttended` | members filter `inactive`; stats API |
| `new_students_today` | «Новые ученики» | students whose membership started since the club-local midnight | `countNewStudents` | stats API only (not drawn since wave 5) |
| `checkins_7d` / `_30d` / `_today` | «Отметок за неделю / сегодня» | students' attendance records in the window | `countStudentCheckins`, `studentCheckinsWhere` | dashboard «Отметок сегодня»; 7/30 days: stats API, AI |
| `mrr` | «Регулярный доход в месяц» | current paid time-boxed abonements (anyone's), each `(amountPaid − refundedAmount) × 30 / term days` (a fully refunded one adds 0); open-ended or not-started packs add 0; dominant currency | `computeRevenue` over `loadCurrentSales`, `loadMonthlyRecurringIncome` | dashboard «Деньги», «Прогноз выручки», weekly digest |
| `payments_received` | «Получено» | paid sales by payment date: abonements (former members' too) + event tickets | `loadSales`, `domains/payments/journal.ts` | «Платежи» summary, CSV, AI `revenue_report` (`received`) |
| `refunds` | «Возвращено» | refunds of those sales by refund date (`refundsInRangeWhere`; unapplied online payments' refunds excluded) | `loadRefunds`, `domains/payments/journal.ts` | «Платежи» summary, CSV, AI `revenue_report` (`refunded`), `club_overview` (`refunded30d`) |
| `revenue_30d` | «Выручка за 30 дней» | `payments_received` − `refunds` over the trailing 30 days (a refund lowers the window it was made in, whenever the sale was); суммы фактически к оплате, после скидок (a discount already lowered `amountPaid`, `discounts_given` is never subtracted again); compared with the 30 days before (`revenuePrev30d`, same rule, `netRevenue`) | `computeRevenue` over `loadSales` + `loadRefunds` | dashboard «Деньги» (+ change vs the previous 30 days), AI `club_overview`, «Платежи» default «Итого» |
| `revenue_today` | «Выручка сегодня» | the same since the club-local midnight | `sumRevenue` over `loadSales` + `loadRefunds` | stats API only (not drawn since wave 5) |
| `discounts_given` | «Скидки» | over paid sales in the window (by `paidAt`) recorded with a `listPrice`: Σ `max(0, listPrice − amountPaid)`; named part `discountAmount`, rest «разовая» (attributed to `pricedById`); refunds don't change it; never subtracted from revenue | `domains/discounts/discount-rules.ts` `saleDiscount`, `domains/payments/journal.ts` totals | «Платежи» summary and CSV, AI `revenue_report`, «Скидки» tab (`given` per discount; «Кто давал скидки» per staff member) |
| `expected_revenue_30d` / `_90d` | «Ожидается за 30 / 90 дней» | renewals of current students' abonements inside the horizon × each student's renewal probability (club renewal share scaled by churn score), from the hourly snapshot; «Если все продлят» = the same at probability 1 | `expectedRevenue`, `loadExpectedRevenue` | «Прогноз выручки» (30, 90), weekly digest; stats API (30) |
| `money_at_stake` | «на кону» / «На кону у учеников с высоким риском» | sum of the students' average monthly spend over 180 days (`monthlySpend`, snapshot) over net amounts (`amountPaid − refundedAmount`): over the call list / over high-risk students | `domains/analytics/churn-score.ts` `monthlySpend`; `loadCallList`, `loadForecastReport` | «Кому позвонить», «Прогноз выручки» |
| `awaiting_payment` | «Ожидают оплаты» | abonements sold and not paid (ACTIVE or EXPIRED, held by a member): the people who owe and the agreed amount | `domains/subscriptions/renewal-rules.ts` `awaitingPaymentWhere`, `countAwaitingPaymentMembers`; amount `summarizeAwaiting` | dashboard «Нужно решение» (people from the list endpoint; the total for club admins), «Продлить → Ожидают оплаты» header, members filter `unpaid`. The per-row agreed price is shown to sport leads too: it is what they collect in cash (Q1), not club revenue |
| `renewals_due` | «Продлить» | students needing the next abonement (`renewal-rules.ts` header: pack empty/last class, term ends within 7 days, or ended within 30 days, next one not bought) | `renewal-rules.ts` `countRenewalsDue`, `loadRenewalDue` | dashboard «Нужно решение» (sport leads), «Продлить» list, members filter `renew`, announcement audience |
| `call_list` | «Кому позвонить» | B1 | `domains/retention/call-list.ts` `loadCallList` | B1; dashboard «Нужно решение» |
| `payroll_classes` | «Занятий (к оплате)» | a coach's group classes of a club-local month with an opened roster that the schedule still holds (not cancelled; personal trainings and events excluded), credited to `AttendanceSession.coachId`; «к оплате» = marks ≥ the rate's threshold | `domains/payroll/payroll-rules.ts` `countedClasses`, `computeLines` | «Отчёты → Выплаты», `payroll.csv`, «Мои выплаты» |
| `payroll_marks` | «Отметок» | marks in those classes except the coach's own (guests count) | `payroll-rules.ts` `countedClasses` | «Отчёты → Выплаты», `payroll.csv`, «Мои выплаты» |
| `payroll_revenue_base` | «Оплаты учеников {тренера}» | abonement sales paid in the month (`paidInRangeWhere`) − refunds of abonement sales made in it (`refundsInRangeWhere`), each split by the abonement's marks in the month's counted classes, else equally between the holder's groups' primary coaches (largest remainder); tickets excluded; the club's dominant tariff currency | `payroll-rules.ts` `attributeRevenue`, `payroll-loader.ts` | «Отчёты → Выплаты», `payroll.csv`, «Мои выплаты» |

**Decisions (wave 3).**
- `domains/metrics/` holds the people and money functions (`students`, `active-students`,
  `abonements`, `attendance`, `revenue` — moved from `features/get-workspace-stats/revenue.ts` —,
  `expected-revenue`); renewals and the receivable stay in `domains/subscriptions/renewal-rules.ts`
  (B3) and are only imported.
- One student base for every count (`studentWhere`): the dashboard used to count every status
  (315), the forecast its snapshot rows (313), the bill `status ≠ INVITED` (293). Now all read 313
  on the demo club. The bill moved from `PlatformBillingService.countActiveMembersMany` to
  `countActiveStudentsMany` (callers: the bill, the trial cost, the platform console list and
  «отметить оплату»); a blocked or suspended member is no longer billed.
- Dashboard: «Активные абонементы» (abonements) → «Ученики с абонементом» (people, moved out of
  «Финансы» into «Ученики и продления»); «Активны за неделю / месяц» (check-in based, clashing with
  the billing «активный») → «Были на занятиях за неделю / за 30 дней»; the duplicate «Уникальных за
  месяц» removed; «Неактивны за месяц» → «Не были на занятиях 30 дней» (sum with «Были на занятиях
  за 30 дней» = «Ученики»); «Новые участники» (counted students) → «Новые ученики»; «Активные
  ученики» added; «К продлению» + «Доступ истекает» + «Доступ закончился» → one «Продлить» tile
  (sport leads, `retention.renewalsDue`, links to `retention?tab=renew`); a fourth money tile
  «Ожидается за 30 дней» links to the forecast, so the three monthly money figures sit side by side
  with subtitles saying what each is («оплаченные действующие абонементы в пересчёте на 30 дней» /
  «фактически оплачено за последние 30 дней» — since the payments journal's phase B «фактически
  оплачено за последние 30 дней за вычетом возвратов» / «продления в ближайшие 30 дней с поправкой на риск
  ухода»). «Ожидают оплаты» counts people («не оплатили: N учеников»). Check-ins (week, 30 days,
  today, trend) count students only.
- Stats DTO: `counts.{students, activeStudents, studentsWithAbonement}`,
  `attendance.attendedStudents7d/30d`, `retention.{notAttended30d, renewalsDue}` (null below sport lead),
  `revenue.{mrr, revenue30d, expected30d, awaitingPayment.{students, amount}}`,
  `today.newStudents`; `activeSubscriptions`, `activeMembers*`, `distinctAttendees30d`,
  `inactiveMembers30d`, `expiredAccess`, `expiringSoon` removed. Money stays club-admin only.
- «Прогноз выручки»: «Средние траты в месяц» (sum of the 180-day average spend, a third monthly
  figure, 1 341 735) replaced by «Регулярный доход в месяц» = `mrr` over the filtered students'
  abonements; `members` (snapshot rows) → `students` (live, filtered by the scope's groups);
  DTO `members/monthlyRecurring` → `students/mrr`. The horizon cards read «Ожидается за 30 / 90
  дней». The weekly digest says «Учеников: N, регулярный доход в месяц — X» (it said «Активных
  учеников» for the snapshot count).
- AI `club_overview`: `members.{total, active}` (every status / status ACTIVE) and
  `abonements.current` → `students.{total, active, new30d, withAbonement}` from the same functions.
- Members list header «Участники (N)» was already right (everyone but invitations; staff included).
  Mobile shows none of these metrics (home/«Прогресс» show the call list — B1 — and the coach's own
  attendance overview), so no mobile change.
- Smoke (local DB, ACADEMY, own server; the demo data has aged):

  | Metric | Before (old definitions) | After — every surface |
  |---|---|---|
  | students | dashboard 315 · forecast 313 | dashboard 313 · forecast 313 |
  | members | members list 325 | members list 325 |
  | active students | bill 292 · «Активны за месяц» 279 (check-ins) | dashboard 292 · bill 292 |
  | attended 30 days | «Активны за месяц» 279 · «Уникальных за месяц» 279 | «Были на занятиях за 30 дней» 279 |
  | not attended 30 days | 34 | dashboard 34 · members filter 34 (279 + 34 = 313) |
  | abonement holders | «Активные абонементы» 281 (abonements) | «Ученики с абонементом» 277 (people) |
  | monthly money | MRR 1 159 900 · forecast «средние траты» 1 289 819 | dashboard 1 159 900 · forecast 1 159 900 |
  | expected 30 days | forecast only | dashboard 759 915 · forecast 759 915 |
  | awaiting payment | 5 abonements | dashboard 5 · list header 5 · members filter 5 (25 400 ₽) |
  | renewals due | three tiles | dashboard 93 · «Продлить» 93 · members filter 93 |

  Admin and owner identical; the head coach gets the same counts, no money (`revenue` null,
  forecast and bill 403).
- Acceptance spec: `apps/server-e2e/src/analytics/metric-glossary.e2e-spec.ts` builds one club
  (owner, coach, four students, an applicant, a blocked member) and asserts every glossary metric
  on stats, forecast, bill, members list + filters, «Продлить» and «Ожидают оплаты».

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

**Decisions (wave 3, B3).**
- One module: `domains/subscriptions/renewal-rules.ts`. `renewalNeed` (per-scope rule, moved from
  `list-renewal-candidates-utils`, now deleted) over `studentsIn` (B2 student base); `loadRenewalDue` /
  `renewalDueUserIds` / `countRenewalsDue` / `isRenewalDue`; `awaitingPaymentWhere` (moved from
  `get-workspace-stats/revenue.ts`), `owesPaymentWhere`, `countAwaitingPaymentMembers`. Readers: «Продлить»
  list, members filters, announcement push + feed, dashboard tile, renewals CSV, AI `renewals_due`.
  `manage-announcements/renewal-segment.ts` is deleted (its Prisma/JS twins disagreed with the list).
- Rule change: a member with no current abonement whose access window lapsed **more than 30 days ago**
  is no longer «на продление» (left the club; same window as the call list's «Абонемент кончился»).
  The «Только на продление» audience now also honours «renewed ahead» (a healthy abonement of the same
  scope), like the list. Staff and the owner never count (students only).
- `GET renewal-candidates` and `GET awaiting-payment`: `gymId/directionId/groupId/coachId`
  (`resolveAnalyticsScope`, foreign id → 404; members of the matching groups via
  `analyticsScopeMemberWhere`), `curPage`/`perPage` (50, max 200), `total`; awaiting adds `members`
  (people). Renewal rows add `phone` and `guardians`. Both stay `SPORT_LEADS` (direction managers and
  coaches don't get the tab).
- Admin: `ws/retention` has tabs «Позвонить» (unchanged call list) · «Продлить» (sport leads only,
  `?tab=renew`): header «N ученикам пора продлить», analytics filters, «Ожидают оплаты · N учеников»
  section (only when non-empty), renewal table; rows open the member card (assign / mark paid live
  there — no list action exists). Dashboard tile «Продлить» → `retention?tab=renew`, value `countRenewalsDue`.
- Members filters: `access=all|renew|unpaid|inactive` («Кончается абонемент» / «Должники» / «Не были
  30 дней»; `?filter=` deep-links); `expiring`/`expired` (access-window segments) are gone. Rows lose the
  date editor, Сохранить, Бессрочно and Удалить; each abonement shows its own end, the access window
  only for a member without abonements.
- Member card: «Доступ к приложению до …» only when it differs (by local day) from the latest current
  abonement end; the label (and «⋯ → Изменить доступ к приложению») opens the override dialog (date,
  «Без ограничения», «Как у абонемента»). «⋯ → Удалить из клуба» moved here from the list rows.
- «Тарифы и абонементы» lists no people → `ClubAdminGate` again (the nested plan-page gate is folded
  into it); e2e role matrix: `subscriptions` is club-admin-only for head coach and coach, and every sport
  lead visits `retention?tab=renew` (new `tabs` field).
- Smoke (local DB, ACADEMY, own server): owner / admin / head coach — list 93 = members filter `renew` 93
  (same ids) = dashboard tile 93 = renewals CSV 93; awaiting 5 abonements / 5 people = filter `unpaid` 5 =
  tile 5; direction manager 403 on the list.

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

**Decisions (wave 2, B4 + F1 + F2).**
- **Calendar = the only editor of time.** Absorbed from the group pages into the class panel
  (`ClassDetailsSheet`, which now reads `GET groups/:id` for the class's group): a break of several
  days (from / to, whole group or only this time; = the old «Отмены и отпуска» form), lifting a
  period or whole-group cancellation from any of its cancelled classes («Снять отмену»; a one-day
  cancellation keeps «Вернуть»), places per weekly time for a booking group, and «Убрать из
  расписания с этой даты» — ends the weekly series the day before (`effectiveUntil`), so past classes
  stay in history; a series that starts on/after that date is deleted. The old «Удалить» slot
  deleted the series with its history. `GroupScheduleBlock` is gone; nothing outside the calendar
  creates, moves or cancels classes. Anyone may edit the classes of a group they coach (primary or
  assistant), like the server's `assertCanWriteGroup`; sport leads everything, direction managers
  their directions. Ending a booking series (`effectiveUntil`) or deleting a booking slot releases
  the live bookings of the classes that no longer happen (`cancelByClub`, push, nothing burned);
  classes up to the end keep theirs. The running-slot cut for the list and the card is today in the
  club's time zone.
- **«Группы и залы»** (sidebar renamed from «Группы и расписание»): tabs «Группы» (compact table:
  name with a direction dot · hall · coach +N assistants · students · «Пн, Ср 19:00 · Сб 11:00»)
  and «Залы» (`?tab=gyms`; name · address · N groups). One primary button per tab («Добавить
  группу» / «Добавить зал», the latter for sport leads); create/edit in side panels
  (`GroupFormSheet`, `GymFormSheet`); a new group opens its card. Demo club: 21 rows ≈ 1.2 screens
  at 1440×900, 8 buttons (was 12.1 screens, 191 buttons).
- **Group card**: hall (→ gym card), coaches (assistants added/removed here), mode with spots and
  booking overrides, students count, the schedule read-only (weekly times with their date bounds,
  one-off classes, cancellations) with «Изменить в расписании» → `/schedule?group=<id>`, occupancy,
  and the roster. «Изменить» opens the panel (name, hall, coach, direction, mode — no roster);
  «Удалить группу» lives in «⋯». The old `?edit=` deep link to the list is gone.
- **Roster**: `GET groups/:groupId/members?q=&curPage=&perPage=` (default 50, max 200; ordered by
  last name, first name, id). Who may read it = who may open the card (`resolveGroupAccess`: admin
  scope and `coach_read_all` any group, `coach_own_only` only own/managed-direction groups, 403
  otherwise); abonements and «Кому позвонить» risk only for whoever runs the group, computed for the
  page only. `q` = the members-list search (every word in name / e-mail / phone or a guardian's),
  now shared as `domains/users/user-search.ts`. Admin card: 25 per page, search, «Добавить ученика»
  (server-side picker) and «Убрать из группы» in a row «⋯» (single add/remove endpoints; the admin
  no longer calls the full-list `PATCH …/members` sync — the endpoint stays for API clients).
- **Slim `GET /groups`**: id, name, gym {id, name}, direction, coach, coaches, bookingMode,
  memberCount, `week` [{dayOfWeek, startTime}] — distinct weekly times of slots still running today
  or later, one-off classes excluded. Dropped: members, slots, exceptions, createdAt, gym address,
  booking spots/overrides (all on `GET groups/:id`, which no longer carries a roster either). Demo
  club: 84.6 KB → 15.5 KB raw (≈2.5 KB gzip, which Caddy serves in prod); the card 16.8 KB → 1.4 KB
  plus 12.6 KB per 25-row roster page. Every other `listGroups` caller compiled unchanged (they use
  ids, names, hall, direction, coaches).
- **F2**: `listAllWorkspaceMembers` → `listAllStaffMembers` (always `staffOnly`; coach and manager
  pickers on groups, directions, events). Students are picked with `MemberSearchPicker`
  (`q`, 20 results, debounced) — in the new-group panel and on the card. Groups page API data
  311 KB → 24.7 KB (of which `groups` 15.1 KB; the rest is the shell: billing, gyms, settings).
- Mobile has no `GET /groups` caller (it uses `me/groups` and the schedule) — unchanged.

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

**Decisions (wave 4, navigation).**
- Sidebar (`ws/workspace-sidebar.tsx`, `navGroups`): «Каждый день» Сегодня · Расписание · Ученики ·
  Удержание; «Деньги» Абонементы · Отчёты; «Клуб» Группы и залы · Пояса · Курсы и видео · Новости и
  события; «Настройки» pinned to the bottom. 11 items for the owner. Account menu (avatar + name in the
  footer): Мой профиль · Подписка ClubSpace (club admins) · Сменить клуб · Выйти.
- Sections spanning several routes are one sidebar item with a URL-driven tab row
  (`shared/workspace/section-tabs.tsx`, tab sets in `ws/sections.ts`): links with `aria-current`,
  arrow keys / Home / End, each tab filtered by role and club section; a lone tab renders no row. The
  sidebar item opens the first tab the role may see and stays lit on all of them. Title = sidebar
  label; sub-page headings dropped (the tab names them).
  - «Отчёты»: Выручка и прогноз (club admin) · Загрузка залов · Тренеры (sport lead) · Когорты новичков
    · Выгрузка (club admin, CSV exports moved from Settings) · Спросить ИИ. `ws/analytics` forwards
    client-side to the first allowed tab (the role is client state); a plain coach gets the gate notice.
  - «Абонементы»: Тарифы · Платежи (`ws/subscriptions/payments`, the online-payments list; keys are in
    «Настройки → Оплата»).
  - «Пояса»: Аттестации (default) · Лестницы. «Новости и события»: Объявления · События.
- **Head coach / direction manager keep «Отчёты»** (deviation from «1–4, 7–10»): section 1 gives them
  occupancy, cohorts, coaches comparison (sport lead) and the AI chat, and hiding the item would leave
  those pages reachable only by URL. They see it without the money tabs, and the «Деньги» group label
  shows only to club admins (the item then sits in an unlabelled group). Plain coach: 1–4.
- «Присвоить участникам» removed from the ladders page with its server routes (`GET …/roster`,
  `POST …/promotions`): bulk promotion = completing a grading, single grant = member card
  («Выдать»).
- Dashboard «Последние действия» removed, and `recentEvents` with it from `GET …/stats`.
- «Мой профиль» (account menu dialog) edits the user's own name through `PATCH /me` for every role;
  the e-mail is shown, not editable (the server never allowed changing one's own e-mail from a club).
- «Импорт из Excel (CSV)»: «Ученики» → «⋯» (club admins); route `ws/club-import` unchanged.
- «Тариф» → «Подписка ClubSpace» for the page, links, banners, e-mails and server messages; inside the
  page ClubSpace's pricing tiers stay «тариф «Старт»» and the list is «Тарифы ClubSpace». The paid
  module «Онлайн-оплата» keeps its name (the page of that name is gone).
- Weekly digest push links to the report its first action names (was the removed hub).
- E2E: the crawler follows `[data-section-tabs]` links on every visited page (a tab of a blocked route
  fails the run) and, as the owner, checks every legacy URL lands on its new route
  (`LEGACY_REDIRECTS` in `apps/admin-e2e/src/role-matrix.ts`).

**Decisions (wave 4, settings).**
- «Настройки» is one route tree `ws/settings/**` behind `ClubAdminGate` (in `settings/layout.tsx`) with
  a vertical section menu (`features/settings/SettingsNav.tsx`, horizontal scroll on narrow
  screens): «Профиль клуба» `settings` · «Направления» `settings/directions` · «Права тренеров и
  запись» `settings/access` · «Приложение учеников» `settings/app` · «Оплата» `settings/payments` ·
  «Интеграции» `settings/integrations` · «Уведомления» `settings/notifications` · «История
  изменений» `settings/audit`. Club import stays at `ws/club-import` (Ученики → ⋯, launch checklist).
- Old routes redirect server-side with the query kept (`shared/workspace/legacy-redirect.ts`):
  `public-page` → `settings`, `directions`, `integrations`, `audit` → `settings/<same>`,
  `achievements` → `settings/app`, `payments` → `settings/payments` (the online-payments list is
  «Абонементы → Платежи» `subscriptions/payments`).
- «Профиль клуба» = public page (address, city, description, logo, catalogue listing) + «О клубе»
  (contacts, links, rules) + the club time zone in one form with one «Сохранить» and the dirty
  guard. The three stores keep their endpoints; save writes only the changed parts in order
  (page → about → time zone), each saved part becomes the new baseline at once, so a failure
  names the part and leaves only unsaved parts dirty. Only changed parts are validated.
- Core app sections stay switchable: `subscriptionEnabled=false` changes behaviour, not only the
  menu — bookings and guest visits stop requiring an abonement (`class-booking.service.ts`,
  `drop-in-eligibility.ts`), online purchase is refused, the launch checklist drops tariffs and
  payments; `scheduleEnabled=false` turns guest visits off. A free club can rely on that, so
  Абонемент, Расписание, Посещаемость sit in a collapsed «Дополнительно» group (opens by itself
  while one is off). Local DB: both demo clubs have all three on; `docs/club-setup.md` passes any
  `PATCH /settings` field. `appSections` marks them `core` (the platform console lists all alike).
- Achievements config lives in «Приложение учеников», shown while the section is on; create/edit
  in a side panel, row actions in «⋯», «Добавить набор по умолчанию» offered only for scopes
  without achievements (no dead button). The settings tree is club-admin only, so head coaches and
  direction managers lose the achievements screen in the admin; the server tier (lead) is
  unchanged.
- The weekly digest toggle (`features/notifications/AnalyticsDigestToggle.tsx`) is the only item of
  «Уведомления»: the club has no club-level notification settings; members' personal
  notification switches stay in the mobile app.
- CSV exports left Settings for «Отчёты → Выгрузка».

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

**Decisions (wave 5).**
- «Ученики»: title row = «Ученики» · «Пригласить» (the page's one filled button, every staff role) ·
  «⋯ → Импорт из Excel (CSV)» (club admins). The list follows at once; join requests sit above it as
  a compact group only while there are any. «Пригласить» opens a side panel
  (`features/invite/InviteSheet.tsx`): «Код клуба» (code, link, QR, «Распечатать плакат», «Сменить
  код», auto-approve — `ClubCodeSection`, was `InviteMembersCard`) for all staff; «По e-mail»,
  «Добавить ребёнка» and «Ожидают принятия» for sport leads. `users?invite=1` opens it (launch
  checklist step).
- A join request row keeps two actions, «Принять» (outline) and «Отклонить» (ghost): deciding is the
  row's whole job, and a «⋯» holding one item is worse than showing it.
- Roster row = name (+ «Ребёнок» and a plain «Родитель: Имя» line) · role only for staff and the
  owner · status only when not active · each abonement «план, осталось N из M, до дата» (or the
  manual access window when there is none) · «Долг» with a red dot. The whole row opens the card;
  no buttons. E-mail, last visit and video progress left the row (search still finds by e-mail).
  `GET …/members` gained `owesPayment` (same rule as the «Должники» segment, `owesPaymentWhere`)
  and lost `lastCheckInAt`, `watchedCount`, `inProgressCount`, `lastWatched*`,
  `workspaceVideoTotal` and their four queries; `MemberProgressBlock` is gone.
- The roster opens sorted «По имени». The access-window order (`accessUntil asc`) stays as «По дате
  окончания доступа»: it leads with people whose access lapsed long ago, so it can't be the
  default. «Who expires next» needs a nearest-to-today order that Prisma can't express without
  raw SQL; that list is «Удержание → Продлить» and the «Кончается абонемент» filter.
- «Абонементы → Тарифы»: tariffs first, archived ones last and dimmed; «Добавить тариф» (filled)
  and «⋯ → Изменить» open `features/subscriptions/PlanFormSheet.tsx` (the old form, dirty guard
  kept; closing a changed panel asks the guard's «Уйти без сохранения?» via `confirmLeave()`).
  Row tap = tariff page; its «Редактировать»
  (`?edit=`) and the checklist (`?new=1`) open the panel. «⋯» = Изменить · В архив / Вернуть из
  архива · Удалить. Пробное / с первого занятия / онлайн moved from chips into the details line.
- Archive and «Вернуть» don't confirm (undoable). «Удалить» reads the tariff page first: with
  current holders it says «У тарифа N действующих абонементов» and offers «В архив» instead (the
  server refuses deleting any tariff that was ever sold anyway).
- Freeze-request decline: the inline form (open → comment → «Отклонить») is the confirmation; the
  extra `window.confirm` was dropped rather than turned into a second dialog.
- **F8 `ConfirmDialog`** (`shared/ui/confirm-dialog.tsx`): `confirmDialog({ title, description,
  confirmLabel, cancelLabel, destructive }) → Promise<boolean>` on the ui-kit `Dialog`;
  `<ConfirmDialogHost />` is mounted once in `app/(dashboard)/layout.tsx` and asks queued requests
  one by one. Esc, the cross, a click outside and «Отмена» answer `false`; Enter and the confirm
  button `true` (it has focus on open). Destructive = solid red button, default label «Удалить»,
  else «Подтвердить». Without a mounted host it rejects (component specs render the host). Title =
  the question naming the object; description = consequences from data already on the page
  («В группе 21 ученик — они останутся в клубе без группы»), never a restated title. Undoable
  actions (archive, hide, unpublish) don't ask.
- Dirty guard: in-app link clicks and `confirmLeave()` (now `async`, callers await it) ask through
  the dialog («Уйти без сохранения?» · «Есть несохранённые изменения — они пропадут.» · Остаться /
  Уйти). The capture listener holds the click and, after «Уйти», replays it on the same link so
  Next's `<Link>` navigates as usual (a link gone from the page by then → `location.assign`, with
  the `beforeunload` listener removed first so the browser doesn't ask again). `beforeunload`
  stays the browser's own prompt — a page can't replace it. Every create/edit panel closes through
  `await confirmLeave()` (Esc, outside click, «Отмена»; its form registers `useDirtyGuard`), so
  closing with changes asks the same question — events, announcements, tariffs, ladders, levels,
  gradings, directions. `confirmDialog` uses the `new Promise` executor, not
  `Promise.withResolvers` (missing in Safari < 17.4 / Chrome < 119, not polyfilled by Next).
- `window.confirm` left in `apps/admin/src`: 0.
- «Пояса → Лестницы»: «Добавить лестницу» (the one filled button) and a ghost «Добавить уровень» per
  ladder open side panels (`features/ranks/LadderFormSheet.tsx`, `LevelFormSheet.tsx`); no form is
  open by default. Ladder header tap → ladder panel (name, «Для кого», direction, «Активна»,
  «Удалить» in the footer — a 2-item «⋯» would be worse). Level row tap → level panel (name,
  colour, stripes, «Допуск к аттестации»); «⋯» = Выше · Ниже · В архив · Удалить.
  `LevelRuleEditor` is gone. «Для кого» stays free text as the server stores it (demo data is
  Russian; there is no `adult/kids` enum).
- «Пояса → Аттестации»: «Новая аттестация» (secondary, only while an active ladder exists) opens
  `features/gradings/GradingFormSheet.tsx`; «Валюта» shows once a fee is typed, «Зал» only if the
  club has halls. The grading page's four confirmations name who is promoted to what (up to 5
  names, «и ещё N»), that members get a notification and that it can't be undone.
- «Настройки → Направления»: row = colour dot · name · «N групп · руководитель: …», one «⋯»
  (Изменить · В архив · Удалить). Managers moved from every row into the direction panel (they save
  at once, apart from «Сохранить»). «Удалить» is offered only for a direction without groups (the
  server refuses any used one and names the usages). Direction emoji are not shown anywhere in the
  admin (chip, select, filter, scope picker); the field stays in the panel as «Значок» because the
  member app shows it on the achievements screen.
- «Приложение учеников → Достижения»: the emoji column left the list (the badge face stays a
  panel field — it is what members see); deleting says how many members unlocked the badge and
  points to «Выключить».
- «Новости и события»: «Новое объявление» opens `features/announcements/AnnouncementFormSheet.tsx`
  for create and edit (dirty guard per form); card tap = editor, «⋯» = Опубликовать / В черновик ·
  Закрепить / Открепить · Удалить. A date in «Опубликовать позже» turns «Опубликовать» into
  «Запланировать» (one filled button). Events: `features/events/EventFormSheet.tsx` wraps
  `EventForm`; row tap = editor (for those who may edit it), the one trailing control is
  «Записавшиеся» (only with registration); delete is in the panel footer and counts registrations
  and waitlist. Hall and coach on an event row are plain text (no links inside a row button).
  Registration rows: the three payment-method buttons became one «Отметить оплату» menu.
- «Курсы и видео»: course rows are links without controls; editing and deleting a course live in the
  course page header «⋯» (Изменить курс · Новый раздел · Удалить курс). Video rows lost the per-row
  access select (read-only text), «Удалить» and the «Действия» column; «Повторить» shows only for
  a failed video inside its status cell; one video is deleted on its page («Удалить видео», the
  confirmation counts its courses); the list keeps the bulk delete. «Slug» → «Адрес в ссылке».
  Lesson rows already met the rule (drag, tap, one «Убрать»).
- «История изменений» (`features/audit/audit-meta.ts`): metadata shows only what has a Russian
  label. The server already swaps known ids for names before sending the log
  (`AuditService.list` → `humanise`: people «Имя (email)», halls, groups, events, videos, courses,
  chapters, roles, schedule times «Пн 19:00 (90 мин)», cancellations), so those keys are labelled
  («Участник», the coach in the club's words, «Зал», «Группа», «Время в расписании», «Отмена»,
  «Роль до/после» translated, «Глава», «Направление»); a value that is still an id (not
  resolvable, e.g. a deleted row, a list position `afterId`) is left out, as are keys and enum
  values without a translation — never the raw value. The list now also resolves the target of
  hall, group, event and direction entries (`targetLabelOf`; their target ids were never
  loaded). Course items show the resolved title («Перемещено видео: …») or, for an unresolved
  one, just what happened («Глава удалена»). Field names in `fields`/`changes` are translated
  (`title` → «название»); `slug` → «Адрес страницы»; video id lists → a count; dates are
  formatted; AI tools, data mode, club type and bulk actions are translated; a platform request
  shows the club area («Раздел: Ученики»). An action or target the build doesn't know reads
  «Изменение в разделе «…»» / «Объект». «Слот расписания» → «Время в расписании».
- `moduleActionConfirm` (`billing-view.ts`) now returns the dialog options instead of a confirm
  text; `publishPushText` (`announcement-target.ts`) returns the consequence line that the caller
  puts into the dialog's `description`. Refund dialogs say «Деньги вернутся тем же способом,
  которым платил участник». ClubSpace billing after a failed charge: «Оплатить сейчас» shows only
  while the card renews the plan; otherwise the «Оплатить картой» above is the one pay button.
- Course page: the publish-date badge uses a clock icon instead of «🕒».
- «6 группа(ы)» was already gone after wave 4 (`pluralRu`); no copy change on groups/gyms.
- «Сегодня» (`ws/page.tsx`, `features/dashboard/*`): «Нужно решение» rows, each only while > 0
  (`decisions.ts`): Кому позвонить → `retention` · Продлить → `retention?tab=renew` · Ожидают оплаты
  (people from `GET awaiting-payment` `members`; «на сумму …» for club admins) → `retention?tab=renew`
  · Заявки на вступление → `users` · Заявки на заморозку (`GET freeze-requests`, now wrapped as
  `listPendingFreezeRequests`; one request links to the member card, several unfold into one row per
  member — only the card decides them) · Видео в обработке или с ошибкой → `content`. Beside it
  today's classes and events from the schedule (club-local day, cancelled struck through, «Идёт»;
  a row opens the calendar's day). Below: «Деньги» (club admins: «Регулярный доход в месяц» +
  «Выручка за 30 дней» with the change against the previous 30 days, link «Выручка и прогноз») and
  «Посещаемость» (leads: были на занятиях за неделю / за 30 дней with % of students, отметок
  сегодня). Removed: the 25 tiles, video stats, «Топ по посещаемости» (🥇), «Топ видео», the
  revenue/attendance charts, the tariff breakdown, uppercase labels.
- Roles: plain coach = call list + freeze requests (own groups) + own classes (groups they coach or
  substitute in, like the calendar); direction manager and head coach add the sport-lead rows
  (head coach: renew/awaiting/join; manager: videos) and attendance, no money; club admins all.
- Stats DTO: `revenue.revenuePrev30d` added (sales paid 31–60 days ago in revenue30d's currency;
  one 60-day `loadSales` read instead of six months); `topVideos7d`, `activity`, `counts.courses`,
  `revenue.trend`, `revenue.byPlan`, `attendance.trend` (and `attendance-trend.ts`) removed. The
  other glossary fields stay on `GET …/stats` (the glossary e2e and demo-kit assert them) even where
  the dashboard no longer renders them.
- Launch checklist: payments and video are optional («по желанию»), never hold it open; it lists
  only the steps still to do, counts required ones, hides once they are done, and «Скрыть» is kept
  per club and account in `localStorage` (`clubspace:onboarding-hidden:<ws>:<user>`). Step links:
  `groups?tab=gyms`, `subscriptions?new=1`, `users?invite=1`.
- Calendar: «Год» removed (a stored or linked `view=year` falls back to the week). In the week view
  a run of 3+ classes at once (`dayRuns`, `MAX_SIDE_BY_SIDE = 2`) is drawn as one list card over
  its time span (`RunList`: dot · start · group, full details in the tip, row opens the class);
  the spec said > 3, but at 1440 px a third lane is ≈47 px with no text. Day view keeps blocks
  (halls layout already gives each hall a column). Listed classes are moved from their panel or
  the day view.
- `GET freeze-requests` gained `total` (same scope, uncapped; `data` stays the oldest 100): the
  dashboard count reads it, and an unfolded list longer than 100 ends with «И ещё N — в карточках
  учеников». A failed schedule request shows «Не удалось загрузить расписание на сегодня» in the
  classes block; the «nothing today» line appears only after a successful empty answer.
- Sentence case also in the class panel (Посещаемость, Замена, booking lists) and «Отчёты» tables
  and cards (cohorts, coaches, occupancy, the analytics stat card).
- Measured at 1440×900 (demo ACADEMY): owner «Сегодня» 2 983 → 700 px, head coach 2 173 → 680,
  plain coach 1 985 → 303; tracked-uppercase labels 27 → 0; no filled buttons, no per-row actions.

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

**Decisions (wave 1, E1/E2/E4 + F5):**
- E1 state is computed in the admin (`features/subscriptions/abonement-state.ts`), not on the
  server: no other client needs it — mobile «Мой абонемент» already compares `endDate`, and the
  mobile coach screen labels only current abonements. Expiry uses the server's «current» rule
  (ACTIVE and `endDate` in the future; no `endDate` never expires); «Заморожен» = a freeze covering
  today; «Начнётся» = waiting for the first visit or `startDate` still ahead; legacy `SUSPENDED`
  reads as «Заморожен». «Отменить» only on a live (active/upcoming/frozen) current abonement and
  never in the history list; payment-debt actions stay on history rows.
- Profile header: the membership status is shown only when it is not «Активен», and the access
  label always says «Доступ …» (`Доступ до` / `Доступ истёк` / `Доступ без ограничения`), so it no
  longer reads as an abonement claim next to «Нет действующего абонемента».
- E2: «Нет связи с сервером…» for any axios rejection without `response` (also timeouts) and for
  `fetch` network TypeErrors; an aborted request (`ERR_CANCELED`) gets the caller's fallback.
  Mobile and client helpers already map transport failures to Russian — unchanged.
- F5: `shared/lib/use-dirty-guard.ts` — one tab-wide registry; `beforeunload`, a capture-phase
  click listener on `window` (runs before React/Next `<Link>`; ignores new-tab clicks, other
  origins, #hash jumps) and `confirmLeave()` for programmatic pushes. Native `confirm` until the
  wave-5 `ConfirmDialog`. Browser Back/Forward is not intercepted. Dirty = differs from the last
  saved values (`sameData`); wired into settings (booking rules, timezone, «О клубе»), the tariff
  form, `EventForm`, announcements (new + edit), video detail (title, description, chapters,
  subtitle upload/label, back button) and the member profile (`ProfileEditForm`, notes). A new
  tariff's/announcement's default scope alone does not count as dirty (it loads after mount).
- Member profile: the abonement panel is not mounted (no request) when a coach below the
  sport-lead tier opens their own row — `features/subscriptions/panel-access.ts`. Their own
  profile opens (progress has a self exception) but abonements refuse it; any other out-of-scope
  member already fails on the profile request, so the panel never mounts there.

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

**Decisions (wave 1, F4 + F7):**
- F4 lives in `apps/admin-e2e` (Playwright, `@playwright/test` pinned to 1.62.1 = Chromium 1234;
  fresh machine: `npx playwright install chromium`). Not an nx project and no `package.json`, so no
  workspace/lock entry or nx sync change; run `npm run test:admin-e2e` (= `apps/admin-e2e/run.sh`,
  extra args go to `playwright test`), typecheck `tsc -p apps/admin-e2e/tsconfig.json`. How to run
  and what fails a page: `TESTS.md` «Admin smoke e2e».
- Origins: `ADMIN_E2E_BASE_URL` / `ADMIN_E2E_API_URL` (default `:4200` / `:3000`). The script never
  starts the API (it needs `DEMO_MODE`, `ADMIN_URL` = admin origin, that origin in `CORS_ORIGINS`;
  the port variable is `SERVER_PORT`). If nothing answers on the admin origin it builds the admin
  (`nx build --skip-nx-cache`, `NEXT_PUBLIC_API_URL` = API) and serves a private copy
  (`dist/admin-e2e/<port>`) with the standalone `server.js` — the Docker artifact; `next start`
  refuses `output: 'standalone'`. It passes `S3_UPLOAD_BUCKET_URL` / `S3_ACCELERATE_URL` (the
  per-request CSP needs them, else every thumbnail is blocked), restores the `next-env.d.ts` that
  `next build` rewrites, and refuses a port held by another app.
- One test per role in one page (no parallel tabs: a rotated refresh cookie presented twice ends
  the session). Routes = the rendered sidebar links + `offMenu` + one detail id per list, read
  with the role's own token. A page is settled when no API request is in flight and no loader is
  visible for 500 ms; still loading after 15 s (`ADMIN_E2E_STUCK_MS`) = stuck. Sidebar labels are
  not loaders (the occupancy report is called «Загрузка расписания»). A sidebar link that opens the
  access-denied notice fails too (no teasers, §1).
- Role table `apps/admin-e2e/src/role-matrix.ts`: `blocked` (not in the sidebar, refused by URL —
  notice or redirect; API 403 tolerated there) and `offMenu` (not in the sidebar, still opens).
  Filled with the §1 tiers as implemented in this wave (head_coach: money/system blocked; coach:
  sidebar Обзор/Расписание/Участники/Кто пропадает/Отток, lead pages blocked, groups/content/events/
  cohorts/occupancy off-menu). *Superseded in wave 4:* coach sidebar = Сегодня · Расписание ·
  Ученики · Удержание.
- Exceptions only as listed data in `apps/admin-e2e/src/checks.ts` with a reason
  (`CONSOLE_ALLOWLIST`, `KNOWN_DEFECTS`); both empty. The suite found two app defects, fixed in
  this wave: a plain coach's own member page requested abonements (403), and the video page asked
  for playback of a still-processing video (400; every lesson video on a fresh seed).
- `scripts/verify.sh`: opt-in step `VERIFY_ADMIN_E2E=1`. CI: job `admin-e2e` — empty database,
  `prisma db push`, API with `SEED_DEMO_WORKSPACE=true` (both demo clubs are generated before the
  port opens) and a throwaway `DEMO_LOGIN_CODE`, then `run.sh`. The same recipe passed locally
  (fresh database, `NODE_ENV=test`, storage unreachable); GitHub Actions itself is out of minutes
  since 2026-07-07, so the job has not run there.
- F7: admin `coverageThreshold` 31 / 27 / 23 / 29 (statements / branches / functions / lines),
  just below the 31.30 / 27.37 / 23.86 / 29.93 measured on the wave-1 tree.

**Decisions (wave 2, F3 + F6 without the risk cache and renewal candidates):**
- F3 `POST analytics/refresh`: skipped while both `historyComputedAt` and `riskComputedAt` are
  younger than 5 minutes (`ANALYTICS_FRESH_MS`) — HTTP 200 `{ status: 'fresh', …computedAt }`;
  otherwise HTTP 202 `{ status: 'queued', … }` and a BullMQ job on the new `analytics-refresh`
  queue (feature-local processor like club import, concurrency 2). Single-flight per club by job
  id `refresh-<workspaceId>` (BullMQ ignores an add while that id waits or runs; finished/failed
  jobs are removed, freeing the id). When done — also after a failure — the job emits the
  existing realtime `invalidate` with resource `analytics` to the club room (Redis adapter, so
  any replica). `@Throttle` 5 per minute per person (the user-bucketed `ClubThrottlerGuard`).
- Admin «Пересчитать» shows «Пересчитываем…» and stays disabled until the `analytics` signal or a
  poll (page reload every 5 s) sees a new computedAt; gives up after 3 minutes with a note. A
  fresh answer shows «Данные только что пересчитаны.». Any finished rebuild reloads every open
  analytics page.
- Known, unchanged: the hourly scheduler and a manual job can rebuild the same club at once (as
  the old synchronous refresh could); snapshot rows replace per club in one transaction.
- F6 `rank-readiness`: `curPage`/`perPage` (default 50, max 200, members-list convention),
  `readyOnly`, output `total` (matching rows) + `summary { all, ready, readyUnlisted }` over the
  whole ladder in scope. Order: ready first, within them not yet on a grading list first, then by
  what is left. Gradings page asks for 50 ready (or all) with «Показать ещё»; «Готовы · N» =
  `summary.ready`. Mobile Progress card asks for 5 ready and takes its counts from `summary`
  (cache key gained `:ready`, so an old persisted payload is never read). Demo club: 75 KB → 30 KB
  (gradings default) / 3 KB (mobile); totals 122 / 52 / 44 identical to the old full list.
- F6 `events`: from/to stay optional (default today + 60 days, all callers use it); `to` before
  `from` or a window over 366 days (`EVENTS_MAX_RANGE_DAYS`) is a 400.
- F6 cohorts: one span per member is now summed in SQL (`groupBy userId` with min/max/sum over the
  scope's groups, `having` first visit inside the cohort window ± a month) instead of loading
  every visit stat; the coaches report reads only the scope's groups. Before/after JSON on the
  demo club (8 scopes: club, group, direction, head coach, direction manager; coaches club,
  direction, group) byte-identical, on two different snapshots.

**Decisions (wave 6).**
- F9 source: the hey-api `@hey-api/schemas` plugin (built into `@hey-api/openapi-ts`, locked
  at 0.92.3) — second step of `nx types:generate` (`libs/api-client/openapi-ts.config.ts`, a separate
  run because jobs run concurrently and the types job cleans the folder) emits the JSON schemas
  of the 159 request bodies (`/(Input|InputDto|Body)$/`, 125 KB) to
  `libs/api-client/src/openapi/schemas/schemas.gen.ts`, inside the existing drift gate. Imported
  as `@clubspace/api-client/schemas` (tsconfig path + package export), not via the root index,
  so mobile never sees it. Not the zod plugin: 860 KB of `z.object()` calls do not tree-shake
  and its English messages would need wrapping anyway; plain `as const` literals do — the admin
  build keeps 38 schema objects in one chunk, 3.5 KB gzipped.
- `apps/admin/src/shared/lib/contract-limits.ts`: `FORM_LIMITS.<form>.<field>` = `{ min, max }`
  read from the bodies the field is sent in (create + update, freeze + approve); the strictest
  wins. `exclusiveMinimum` is read in both the 3.0 (`true` + `minimum`) and the 3.1 (number,
  nullable zod fields) form. A field the contract does not bound throws — the spec catches it.
  Field names are type-checked against the schema literals.
- Drift test: `contract-limits.spec.ts`, one `it.each` over every `FORM_LIMITS` entry —
  every body must give the same bound (edited `UpdatePlanInput.durationDays` max to 3000 →
  `plan.durationDays` fails).
- Covered forms: tariff, group, gym, event, announcement, direction, ladder, level, grading
  (sheet + detail page), achievement, club profile (public page + «О клубе», logo size and
  types from `CreateClubLogoUploadInput`), booking settings, slot / class capacity, freeze
  (+ decline comment), sale and «Отметить оплату» amounts, member notes, call-list note, AI
  chat question, AI token name, promote (stripes, note). Error texts are built from the limits;
  `maxLength` was added to inputs that had none although the server limits them (gym, announcement, event
  title/link/description, direction and achievement names). Grep (`maxLength={N}`,
  `{ min: N, max: N }`, `.length > NN`, `MAX_* = N`, `min/max={N}` in `app/` + `features/`):
  88 → 27; the rest is platform-owner screens, auth, billing help, calendar UI and the phone
  digit rule.
- Server change: tariff `price` max 100 000 000 on create and update (the admin already
  capped it; the contract had no bound). Direction / achievement icon: the admin's 8 → the
  contract's 16 (fits ZWJ emoji). Public slug minimum and pattern stay in the admin form — a
  zod `refine` on the server, invisible to the contract.
- F11: no TanStack Query — `apps/admin/src/shared/api/read-cache.ts` (`cachedRead`,
  `peekCachedRead`, `invalidateReads`, ~70 lines, no dependency) inside the wrappers, so every
  caller of `fetchMe`, `fetchWorkspaces`, `getWorkspaceSettings`, `getWorkspaceBilling`,
  `listTags`, `listCategories` shares one request while it is in flight. Kept for 60 s only
  where the data is session-stable: `/me`, `get-my-workspaces`, `members/me` (the membership hook,
  whose own cache moved onto the helper). Settings, billing, tags and categories are never kept —
  each mount still reads the server, so F10's `updatedAt` is never stale. Writes drop what they
  change: settings PATCH → that club's settings + the club list (app sections), billing writes →
  billing (a module also settings + list), `updateMe` → `/me`, tag/category writes → their list,
  self-serve club creation and the platform console's club/feature/module writes → the club
  list; sign-in/sign-out clears all and a late answer of the previous account is dropped.
  Realtime-driven reloads read uncached endpoints; the only cached read on a realtime path is
  `/me` for the viewer's id. Known delay: an app section switched by another admin reaches this
  tab's sidebar within 60 s (it was the next navigation).
- F11 measured (owner, demo club, production build vs API :3153, Playwright, full page load /
  sidebar navigation): dashboard 16 → 14 calls (duplicates 2 → 0), users 9 → 9, schedule 12 → 11
  (1 → 0), content 13 → 11 (2 → 0), settings 10 → 9 (1 → 0), retention 11 → 11; zero duplicate
  requests per load. Sidebar navigation: bootstrap calls per page change 1–3 → 0 (settings page
  keeps its own fresh settings read); the dashboard re-entry made 10 calls, now 7. A load still
  makes 7 distinct bootstrap calls (refresh-token, consent, `/me`, club list, membership,
  settings, billing) — each a different answer, none repeated.
- F12: prod already derives `ROOT_URL` and the admin/app `NEXT_PUBLIC_API_URL` from `DOMAIN` in
  `docker-compose.prod.yml`; what can still split them is a web image built for another
  address (a `DOMAIN` change restarted without `build admin client`) or a hand edit. Check, not a
  second derivation: `check_api_origin` (`deploy/lib/common.sh`) compares the running server's
  `ROOT_URL` origin with the `media-src` the running `admin` and `client` send. `update.sh`
  rolls back on a mismatch (after the smoke check); `healthcheck.sh` alerts as `api-origin`.
  Documented in `deploy/README.md` (Content-Security-Policy, Updates, Monitoring) and
  `.env.example` (local: both on the same origin, e.g. the LAN IP).
- F10 contract: update inputs of group (`PATCH groups/:id`), tariff (`PATCH plans/:id`), club
  settings (`PATCH settings`), announcement (`PATCH announcements/:id`) and the club profile
  parts that share the club row — public page (`PUT public-profile`) and «О клубе»
  (`PUT about`) — take optional `expectedUpdatedAt` (ISO, the `updatedAt` of the last read).
  Different from the row → 409 `STALE_UPDATE` (`StaleUpdateError` in `shared/errors`, a new code
  next to the generic `CONFLICT`, so a form can tell it apart): «Данные изменил другой
  пользователь. Обновите страницу — ваши правки не сохранены.» Omitted = last write wins as
  before (mobile, MCP, AI tools, row toggles).
- Atomic compare-and-set, not read-then-write: `claimUnchanged`
  (`shared/utils/optimistic-concurrency.ts`) runs `updateMany where { id, updatedAt: expected }`
  bumping the version, count 0 → 409, inside the same `$transaction` as the real update (the row
  lock holds to commit, so the second writer with the same timestamp matches nothing). Kept as a
  separate claim so nested writes (tariff directions, announcement groups, group coaches, the
  public slug) stay as they were. Proven on a real API: two simultaneous saves with the same fresh
  timestamp → exactly one 200, one 409, for all six endpoints.
- Versions: group card (`GET groups/:id`) and tariff (list, card, writes) gained `updatedAt`;
  announcements already had it. Settings GET/PATCH and public page GET/PUT expose the club row's
  `updatedAt` (one version for settings, public page and time zone — they are one row). «О клубе»
  is checked against its own `aboutUpdatedAt` (its read's `updatedAt`); its PUT also returns
  `clubUpdatedAt`, so the profile form's later parts carry the row version forward. «О клубе»
  never saved (`updatedAt` null) sends no version — that first save is unchecked.
- Schema: `Plan.updatedAt DateTime @default(now()) @updatedAt` (it had no timestamps). Deploy:
  plain `db push`, existing tariffs backfill to the push time, no data loss, no `migrations()`
  step. Side effect: settings, public page and «О клубе» bump the same club row, so a settings
  toggle saved while another admin edits the public page makes that admin's save 409 (safe,
  occasionally needless).
- Admin: the forms send the version they opened with (captured at open, so a realtime reload
  behind an open panel cannot hide someone else's save): group panel, tariff panel, announcement
  panel, settings «Права тренеров и запись» / «Приложение учеников» (`useWorkspaceSettings`),
  club profile (a ref carrying each part's new version to the next). A 409 keeps the draft and
  shows `StaleUpdateNotice` (`shared/ui/stale-update-notice.tsx`) inline with «Обновить»: group
  and tariff reload the record in place (form reset to it, next save uses the new version),
  settings and club profile reload the section; announcements have no single read endpoint, so
  «Обновить» closes the panel and reloads the list. Not versioned (no form, a deliberate single
  click): tariff archive/restore and announcement pin/publish in list rows, «Принимать без
  подтверждения» on the invite page.

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
- No expired abonement labelled «Активен»; no English «Network Error»; no `window.confirm`.
- Admin smoke e2e green for owner/admin/head_coach/coach in `verify.sh`/CI; coverage ratchet raised.
- tsc clean (server, admin, mobile, client); all tests green; contract in sync.

## 9. Backlog — business gaps (owner decision required; do not start without a go)

**Status 2026-11-15** (owner go: «стартуй разработку»): E1 → `2026-11-15-payments-journal.md`,
E6 → `2026-11-15-requests-inbox.md`, E3 → `2026-11-15-discounts.md`, E2 →
`2026-11-15-member-autopay.md` — designed, implemented, reviewed and committed on the branches
`feat/payments-journal`, `feat/requests-inbox`, `feat/discounts`, `feat/member-autopay`. E4, E5,
E7–E9 not started.

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

**Defaults taken while implementing (owner may overrule):** Q1 yes (head coach assigns abonements,
records cash payments, handles freezes; no prices, refunds or payment keys). Q2 as written (live
rules for membership, snapshot score and money). Q3: owner said «стартуй разработку» on 2026-11-14 →
E1 → E6 → E3 → E2, each its own wave with review. Q4 removed (wave 5). Q5 the plain coach keeps the
admin with four items (Сегодня, Расписание, Ученики, Удержание), scoped to own groups.
