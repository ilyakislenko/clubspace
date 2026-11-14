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
  404), `reason` (chip), `snoozed` (`true` = the contacted ones instead of the ones to call), `page`,
  `perPage` (50, max 200). Response: `data`, `summary` (`total` + per reason + `high` + `snoozed` +
  `moneyAtStake`, over scope and filters, not over the chip or the page), `total` (rows matching
  everything), `page`, `perPage`, `scoredAt`.
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
  (a plain coach). The dashboard tile reads the summary with `perPage=1`.
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
| `students_total` | «Ученики» | students | `countStudents` | dashboard, «Прогноз выручки» card subtitle, weekly digest, AI `club_overview` |
| `students_active` | «Активные ученики» | students with `lastAttendedAt` or `lastSeenAt` (opened the club in the app) within 30 days — what the club pays ClubSpace by | `countActiveStudents`, `countActiveStudentsMany` | dashboard, «Тариф» (bill, tier), platform console, AI |
| `students_with_abonement` | «Ученики с абонементом» | students holding ≥ 1 current abonement (`currentSubscriptionWhere`; paid or not); people, not abonements | `countStudentsWithAbonement` | dashboard, AI |
| `students_attended_7d` / `_30d` | «Были на занятиях за неделю / за 30 дней» | students with ≥ 1 check-in in the window | `countStudentsAttended` | dashboard |
| `students_not_attended_30d` | «Не были на занятиях 30 дней» | students without a check-in in 30 days (never-attended included); = `students_total − students_attended_30d` | `notAttendedWhere`, `countStudentsNotAttended` | dashboard, members filter `inactive` |
| `new_students_today` | «Новые ученики» | students whose membership started since the club-local midnight | `countNewStudents` | dashboard |
| `checkins_7d` / `_30d` / `_today` | «Отметок за неделю / сегодня» | students' attendance records in the window | `countStudentCheckins`, `studentCheckinsWhere` | dashboard (cards, weekly trend) |
| `mrr` | «Регулярный доход в месяц» | current paid time-boxed abonements (anyone's), each `amountPaid × 30 / term days`; open-ended or not-started packs add 0; dominant currency | `computeRevenue` over `loadCurrentSales`, `loadMonthlyRecurringIncome` | dashboard, «Прогноз выручки», weekly digest |
| `revenue_30d` | «Выручка за 30 дней» | paid in the trailing 30 days by payment date: abonements (former members' too) + event tickets | `computeRevenue` over `loadSales` | dashboard (+ trend, by tariff), AI `club_overview` |
| `revenue_today` | «Выручка сегодня» | the same sales since the club-local midnight | `sumRevenue` over `loadSales` | dashboard |
| `expected_revenue_30d` / `_90d` | «Ожидается за 30 / 90 дней» | renewals of current students' abonements inside the horizon × each student's renewal probability (club renewal share scaled by churn score), from the hourly snapshot; «Если все продлят» = the same at probability 1 | `expectedRevenue`, `loadExpectedRevenue` | dashboard (30), «Прогноз выручки» (30, 90), weekly digest |
| `money_at_stake` | «на кону» / «На кону у учеников с высоким риском» | sum of the students' average monthly spend over 180 days (`monthlySpend`, snapshot): over the call list / over high-risk students | `domains/analytics/churn-score.ts` `monthlySpend`; `loadCallList`, `loadForecastReport` | «Кому позвонить», «Прогноз выручки» |
| `awaiting_payment` | «Ожидают оплаты» | abonements sold and not paid (ACTIVE or EXPIRED, held by a member): the people who owe and the agreed amount | `domains/subscriptions/renewal-rules.ts` `awaitingPaymentWhere`, `countAwaitingPaymentMembers`; amount `summarizeAwaiting` | dashboard, «Продлить → Ожидают оплаты» header, members filter `unpaid` |
| `renewals_due` | «Продлить» | students needing the next abonement (`renewal-rules.ts` header: pack empty/last class, term ends within 7 days, or ended within 30 days, next one not bought) | `renewal-rules.ts` `countRenewalsDue`, `loadRenewalDue` | dashboard (sport leads), «Продлить» list, members filter `renew`, announcement audience |
| `call_list` | «Кому позвонить» | B1 | `domains/retention/call-list.ts` `loadCallList` | B1 |

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
  «фактически оплачено за последние 30 дней» / «продления в ближайшие 30 дней с поправкой на риск
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
  cohorts/occupancy off-menu).
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
