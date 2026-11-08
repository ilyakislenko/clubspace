# Admin stability and depth audit (`apps/admin`)

> Appendix to the [spec](2026-11-08-admin-cleanup.md). Snapshot at `6dffabfd`. Paths under
> `/tmp/admin-audit/` and scripts in `/tmp/cs-rec/` lived on the auditor's machine and may be gone;
> the `file:line` references are the primary evidence.

Branch `feat/launch-readiness`, worktree `cs-mobile-build`, 2026-11-08. Signed in as owner `owner@academy.demo`, club ACADEMY (`c851fd8a-…`). Demo data: **325 members, 21 groups, 10 gyms, 59 videos, 9 courses, 108 audit events**.

I ran the admin as a production build (`next build && next start -p 4200`) against the local API. Nothing was changed in the database. The form flows ran with every non-GET request to the API aborted by a Playwright route guard. The only writes that reached that guard are the two listed under flows below.

**Artifacts**
- `/tmp/admin-audit/crawl.json` — per page: load time, console messages, HTTP errors, every API call with timing and size, and a screenshot path.
- `/tmp/admin-audit/flows.json` — the form flows.
- `/tmp/admin-audit/probe2.json` — follow-up probes.
- `/tmp/admin-audit/shots/*.png` — screenshots.
- `/tmp/admin-audit/buttons.json` — buttons found on each page.
- Scripts: `/tmp/cs-rec/audit-crawl.mjs`, `audit-flows.mjs`, `audit-flow-defs.mjs`, `audit-probe2.mjs`.

## Score: 7 / 10 (stability 8, depth 6)

**Stability is good.**
- **Crawl:** 40 real pages crawled. None produced a console error from app code, a JS page error, an HTTP 4xx/5xx, an `error.tsx` fallback or a stuck spinner. The only console errors were on the video page (a CSP issue in my local setup, see #15) and on deliberately bogus ids.
- **Bad ids:** handled inline ("Группа не найдена", "Участник не найден").
- **Code hygiene:** no `any`, no TODO/FIXME/HACK. One shared `errorMessage()` that reads the server's message (223 call sites). Only 10 silent `.catch(() => undefined)`, all on optional side data.
- **Tests:** 500 tests in 71 suites, all passing.

**Two things hold the stability score down:**
- None of the 65 route files is tested (0%), and there is no browser e2e test for the admin.
- Several endpoints called on every page return the whole club in one response, with no limit. That is fine at 325 members but grows linearly with club size.

**Depth is uneven.** The core of running a martial-arts or fitness club is deep:
- schedule, bookings with a waitlist, substitutions and cancellations;
- plans, freezes and manual payments;
- online payments with 54-ФЗ receipts via ЮKassa;
- retention analytics (cohorts, coaches, occupancy, forecast);
- ranks and gradings, family accounts, audit log, CSV exports, import, an LMS.

The business back office that Moyklass, Altegio, 1C Фитнес and Mindbody sell on is mostly missing: lead CRM, recurring member billing, discounts or promo codes, retail/POS, coach payroll, expenses and cash desk, SMS/WhatsApp. So it is a strong club-operations CRM and a weak business-management system.

## Issues

Severity is for a launch with clubs of a few hundred to roughly 2,000 members.

| # | Issue | Evidence | Severity | Fix |
|---|---|---|---|---|
| 1 | **`GET /groups` returns every group with its full roster** (members + user), with no limit. The admin loads it on 12 pages, mostly just to fill filter dropdowns: 5 analytics pages, schedule, retention, users, announcements, gradings, gyms. | `apps/server/src/features/list-groups/schemas.ts:88-91` (`members: { include: { user } }`), `list-groups.handler.ts:41`. Crawl: 84 KB per call at 325 members / 21 groups, e.g. `/ws/analytics/churn`, `/ws/schedule` in `crawl.json`. | Medium (High at 2k+ members) | Make the list slim: id, name, gym, direction, coach, `memberCount`. Load rosters only on group detail or a dedicated roster endpoint. |
| 2 | **The groups page downloads the entire member list** to feed a student picker: `listAllWorkspaceMembers` loops `perPage=200` until done. The same helper runs on the directions and events pages (staff only). | `apps/admin/src/shared/api/members.ts:71-82`, `groups/page.tsx:103-107`. Crawl `/ws/groups`: `members?curPage=1&perPage=200` 144 KB + `curPage=2` 89 KB. The page totals **319 KB of API JSON**. | Medium | Replace with a server-side search combobox (`q=` already exists on `listWorkspaceMembers`). |
| 3 | **"Пересчитать" (analytics refresh) has no throttle or cooldown.** It recomputes the whole club synchronously inside the HTTP request, with no single-flight lock. Only the global limit applies (prod: 20/s, 600/min per user). The UI's `busy` flag guards one tab only. | `club-analytics.controller.ts:168-184` (no `@Throttle`), `refresh-analytics.handler.ts:22-36` (awaits `snapshots.refresh`), `analytics-snapshot.service.ts:53-55` (history + risk recompute, no lock), `app.module.ts:691-692`, `analytics-toolbar.tsx:178-190`. | Medium | Skip the refresh if it was computed under N minutes ago. Run it through BullMQ (already used for other jobs) as single-flight per workspace, and return 202 plus the realtime "updated" event. |
| 4 | **Two overlapping "who to call" lists built on different risk engines.** "Кто пропадает" (`/retention`) uses `GET at-risk-members`, scored live by rules. "Кому позвонить" (`/analytics/churn`) uses the nightly snapshot churn score. Both sit in the sidebar and both log contacts through the same `logAtRiskContact`. | Live data (`probe2.json` → `riskVsChurn`): retention **58** people, churn **30**, overlap 28, **30 appear only on retention**, 2 only on churn. Code: `shared/api/retention.ts:19` vs `shared/api/analytics.ts:41`; `analytics/churn/page.tsx:15`; sidebar `workspace-sidebar.tsx:72-85`. Screenshots `shots/ws_retention.png`, `shots/ws_analytics_churn.png`. | Medium (owner trust: "which list is right?") | One list on one model: show the churn score and the rule reasons as columns, or merge the pages. |
| 5 | **No unsaved-changes guard.** I edited a field in Settings, clicked a sidebar link, and it navigated away with no prompt. The edit was silently lost; returning showed the server value. `beforeunload` does not appear anywhere in the admin source. | `probe2.json` → `settingsDirtyNav: {leftPage: true, prompt: null}`, `settingsAfterReturn.valueRestoredFromServer: true`. A grep for `beforeunload` in `apps/admin/src` returns 0 hits. | Medium for long forms (settings, plans, events, announcements, video text) | A `useDirtyGuard` hook: `beforeunload` plus intercepting sidebar `Link` clicks while dirty. |
| 6 | **Raw English "Network Error" shown to users.** `errorMessage()` only filters axios's `Request failed with status code…`, so a transport failure (offline, CORS, proxy) prints axios's text in a Russian UI. A spec asserts this behaviour. | Reproduced in the schedule "Новая тренировка" dialog and the gym edit form: `shots/flow_schedule_new_class_validation.png`, `flows.json`. `shared/lib/error-message.ts:44-49`; `features/consent/ConsentGate.spec.tsx:156-160` expects "Network Error" on screen. | Low-Medium | When there is no `error.response`, return "Нет связи с сервером. Проверьте интернет и повторите." Update the spec. |
| 7 | **Route files untested and no admin e2e.** Lines are 29.0% covered overall, but all **65 `app/` route files are at 0%** (2,802 lines). That is where loading, error handling and most form logic live. Features with **zero coverage**: ranks (0/142), gradings (0/136), video-player, realtime, theme, `upload-to-s3`. Features with very little: payments 3.9% (`PaymentSettingsCard`, 538 lines, money config), invite 4.4%, `shared/api` 7.1%, groups 8.7%, events 10.4%, club-import 10.9%, platform 12.1%. `apps/` contains only `server-e2e`, no admin e2e. | `npx nx test @clubspace/admin --coverage` → Statements 30.35% (3333/10980), Branches 26.36%, Functions 23.37%, Lines 29.03%. Per-folder figures computed from `apps/admin/test-output/jest/coverage/coverage-summary.json`. | Medium | Add `/tmp/cs-rec/audit-crawl.mjs` (it is already a working route-level smoke test) as a CI Playwright job. Add render tests for users, groups, subscriptions and payments. |
| 8 | **The coverage ratchet is stale.** Thresholds are 14/14/12/14 but actual coverage is 30.4/26.4/23.4/29.0, so coverage could halve and CI would still pass. | `apps/admin/jest.config.cts` (`coverageThreshold`) vs the run above. | Low | Raise to about 29/25/22/28. |
| 9 | **Form validation is copied by hand from the server.** The admin never imports zod (zod is a repo dependency). Server limits are retyped as literals. | Server `features/manage-plans/create-plan.feature.ts:10-12` (`durationDays ≤3650`, `classCount ≤1000`); admin `subscriptions/page.tsx:189-199` repeats `max: 3650` and `max: 1000`. Elsewhere validation is HTML `required` plus a disabled submit (`flows.json`: `group_create`, `event_create` show "Заполните это поле."). | Low (drift risk) | Move the zod input schemas to a shared lib, or generate validators from `open-api.json`. |
| 10 | **More unpaginated, whole-club endpoints on admin pages.** `at-risk-members` scores the whole workspace on every request (54 KB; dashboard + retention). Also `rank-readiness` (75 KB; gradings), `renewal-candidates` (16 KB; dashboard, subscriptions), `events` (optional range, no maximum), and churn/cohorts, which load all snapshot rows and filter in JS. | `features/at-risk-members/list-at-risk-members.handler.ts:68` → `domains/retention/load-workspace-risk.ts`; `list-renewal-candidates.handler.ts:47`; `manage-workspace-events/list-workspace-events.feature.ts:7-10`; `domains/analytics/analytics-reports.ts:109-115`. Sizes from `crawl.json`. Reads are batched: no N+1 found. | Medium at scale | Cap, paginate or summarise. Cache `loadWorkspaceRisk` per workspace for about 60 s (the client already polls at 60 s, `shared/lib/at-risk.ts:28`). |
| 11 | **No client data cache.** 145 hand-written `useEffect` loaders. Every full page load bootstraps 7 calls (refresh-token, me/consent, me, get-my-workspaces, members/me, settings, billing) on 40 of 42 pages. Some calls repeat within a page: `/get-my-workspaces` 2-3× on 9 pages, `/me` 2× on 5, `tags`/`categories` 2× on content. | `crawl.json` → `api[]` per page; e.g. `/ws/users` (bare `/users` redirects there) shows 3× `get-my-workspaces`, 2× `/me`. | Low (perf), Medium (maintainability) | TanStack Query, or at least an in-flight dedupe for the bootstrap calls. |
| 12 | **Destructive actions use native `window.confirm`** (49 call sites). The prompt cannot show what will be lost (e.g. deleting a group with 21 members) and is unstyled. Undo exists only for schedule moves. | e.g. `directions/page.tsx:122`, `achievements/page.tsx:213`, `content/courses/[courseId]/page.tsx:197`; undo in `features/schedule/calendar/ScheduleCalendar.tsx:323,344`. | Low | A shared `ConfirmDialog` that lists the consequences. |
| 13 | **Concurrent edits: last write wins.** No version or `If-Match` checks in update-group, manage-plans, settings or announcements. Partly mitigated by realtime refresh on 10 screens. | grep for `If-Match\|expectedUpdatedAt\|version:` in those server slices: 0 hits. 10 admin files use `useWorkspaceRealtime`. | Low now (Medium for multi-admin clubs) | Send `updatedAt` with edits and return 409 if it is stale. |
| 14 | **Big page files hold fetching, state and UI together** (none over 900 lines). | `wc -l`: `features/platform/PlatformWorkspaceBilling.tsx` 877, `features/audit/audit-meta.ts` 866 (mostly a label table), `videos/[videoId]/page.tsx` 805, `users/page.tsx` 805, `workspace/[workspaceId]/page.tsx` 789, `features/content/VideoUploadSheet.tsx` 789. 45.8k lines across 279 source files. | Low | Split data hooks out of `users/page.tsx` and the dashboard first, since they are the most used and untested. |
| 15 | **Video preview is blocked by CSP when the API's public host differs from `NEXT_PUBLIC_API_URL`.** This one is an artifact of my local setup (API advertises `192.168.1.46:3000`, admin CSP allows `localhost:3000`). It shows that two separate settings must match or playback in the admin silently breaks. | `crawl.json` → `videos/[videoId]` console: "Loading media from 'http://192.168.1.46:3000/videos/…/manifest.m3u8' violates … media-src 'self' blob: http://localhost:3000 …". | Low (config) | Derive both from one setting, or add a startup check. |
| 16 | **Video and course rows navigate with `router.push`, not `<a>`.** They cannot be opened in a new tab and my crawler could not discover them. Dashboard and video-detail links also still point at the legacy `/videos` route, which redirects to `/content`. | `features/content/VideoList.tsx:222`, `features/content/CourseList.tsx:44`; `workspace/[workspaceId]/page.tsx:471,534`, `videos/[videoId]/page.tsx:419`; redirect `videos/page.tsx`. | Low | Use `<Link>` rows and point links straight at `/content`. |

**Flows where nothing was sent**
- Group, gym, event, child and invite forms: client validation blocked submission (native `required`, disabled submit).
- Plan, ladder, grading and announcement forms: submit is disabled until required fields are filled.
- "Назначить" (assign a membership) is disabled with no plan chosen.
- Searching users with no match shows "Никто не подходит под «…»".

**Flows where a write reached the guard**
- The "Новая тренировка" dialog is pre-filled with a group, time and 60 min, so a single click posts a slot (blocked).
- Re-saving a gym unchanged sends a `PATCH` (blocked).

One observation outside stability: create forms are inline on the page rather than in dialogs (`shots/flow_users_search_nomatch.png`). That belongs to the UX audit.

## Crawl summary

\*Load ms runs from navigation start to network idle with skeletons and spinners gone. It **includes Playwright's 500 ms network-idle window**, so the time actually spent rendering and fetching is about load ms minus 500, i.e. roughly 100-400 ms. DOMContentLoaded was 20-40 ms. The data set is small; see issues 1, 2 and 10 for what grows. Screenshot paths are relative to `/tmp/admin-audit/`.

| Page | Load ms* | API calls | API KB | HTTP ≥400 | console err/warn | page errors | Notes | Screenshot |
|---|---|---|---|---|---|---|---|---|
| `/` | 867 | 17 | 114 | 0 | 0/0 | 0 | → /ws | `shots/root.png` |
| `/workspaces` | 769 | 17 | 114 | 0 | 0/0 | 0 | → /ws (auto-picks the only club) | `shots/workspaces.png` |
| `/users` | 762 | 17 | 114 | 0 | 0/0 | 0 | redirect → /workspaces → /ws | `shots/users.png` |
| `/platform` | 563 | 3 | 1 | 0 | 0/0 | 0 | owner correctly gets the "только для администраторов платформы" notice | `shots/platform.png` |
| `/platform/security` | 563 | 3 | 1 | 0 | 0/0 | 0 |  | `shots/platform_security.png` |
| `/ws` (dashboard) | 721 | 14 | 114 | 0 | 0/0 | 0 |  | `shots/ws.png` |
| `/ws/achievements` | 680 | 9 | 15 | 0 | 0/0 | 0 |  | `shots/ws_achievements.png` |
| `/ws/ai-assistant` | 630 | 10 | 11 | 0 | 0/0 | 0 |  | `shots/ws_ai_assistant.png` |
| `/ws/analytics` | 667 | 8 | 6 | 0 | 0/0 | 0 |  | `shots/ws_analytics.png` |
| `/ws/analytics/churn` | 889 | 11 | 120 | 0 | 0/0 | 0 | slowest page | `shots/ws_analytics_churn.png` |
| `/ws/analytics/coaches` | 650 | 11 | 96 | 0 | 0/0 | 0 |  | `shots/ws_analytics_coaches.png` |
| `/ws/analytics/cohorts` | 640 | 11 | 96 | 0 | 0/0 | 0 |  | `shots/ws_analytics_cohorts.png` |
| `/ws/analytics/forecast` | 628 | 11 | 92 | 0 | 0/0 | 0 |  | `shots/ws_analytics_forecast.png` |
| `/ws/analytics/occupancy` | 640 | 11 | 128 | 0 | 0/0 | 0 |  | `shots/ws_analytics_occupancy.png` |
| `/ws/announcements` | 624 | 10 | 96 | 0 | 0/0 | 0 |  | `shots/ws_announcements.png` |
| `/ws/audit` | 639 | 8 | 30 | 0 | 0/0 | 0 | paginated (`perPage=50`) | `shots/ws_audit.png` |
| `/ws/billing` | 632 | 10 | 11 | 0 | 0/0 | 0 |  | `shots/ws_billing.png` |
| `/ws/club-import` | 611 | 7 | 6 | 0 | 0/0 | 0 |  | `shots/ws_club_import.png` |
| `/ws/content` | 645 | 13 | 38 | 0 | 0/0 | 0 | videos paginated (`perPage=30`) | `shots/ws_content.png` |
| `/ws/directions` | 605 | 11 | 13 | 0 | 0/0 | 0 |  | `shots/ws_directions.png` |
| `/ws/events` | 638 | 12 | 20 | 0 | 0/0 | 0 |  | `shots/ws_events.png` |
| `/ws/gradings` | 648 | 13 | 173 | 0 | 0/0 | 0 | rank-readiness 75 KB | `shots/ws_gradings.png` |
| `/ws/groups` | 660 | 12 | **319** | 0 | 0/0 | 0 | full roster + full groups (#1, #2) | `shots/ws_groups.png` |
| `/ws/integrations` | 619 | 8 | 8 | 0 | 0/0 | 0 |  | `shots/ws_integrations.png` |
| `/ws/payments` | 617 | 9 | 7 | 0 | 0/0 | 0 | empty payments list handled | `shots/ws_payments.png` |
| `/ws/public-page` | 622 | 9 | 7 | 0 | 0/0 | 0 |  | `shots/ws_public_page.png` |
| `/ws/ranks` | 625 | 9 | 13 | 0 | 0/0 | 0 |  | `shots/ws_ranks.png` |
| `/ws/retention` | 680 | 10 | 145 | 0 | 0/0 | 0 |  | `shots/ws_retention.png` |
| `/ws/schedule` | 652 | 12 | 146 | 0 | 0/0 | 0 | → `?view=week&date=…` | `shots/ws_schedule.png` |
| `/ws/settings` | 619 | 9 | 8 | 0 | 0/0 | 0 |  | `shots/ws_settings.png` |
| `/ws/subscriptions` | 645 | 11 | 29 | 0 | 0/0 | 0 |  | `shots/ws_subscriptions.png` |
| `/ws/users` | 661 | 13 | 129 | 0 | 0/0 | 0 | members paginated (`perPage=50`) | `shots/ws_users.png` |
| `/ws/videos` | 666 | 14 | 39 | 0 | 0/0 | 0 | → /ws/content (legacy alias) | `shots/ws_videos.png` |
| `content/courses/[courseId]` | 631 | 9 | 13 | 0 | 0/0 | 0 | id `d623acf1…` | `shots/content_courses_courseId_ws_content_courses_d623acf1_ad81_4288_a1a6_b4092f660156_id_from_API_no_a_link_on_list_page.png` |
| `gradings/[gradingId]` | 624 | 8 | 9 | 0 | 0/0 | 0 |  | `shots/gradings_gradingId_ws_gradings_a86434d2_07b4_49aa_a04b_4b74a2beca23.png` |
| `groups/[groupId]` | 622 | 9 | 26 | 0 | 0/0 | 0 |  | `shots/groups_groupId_ws_groups_b9100dad_3eb8_4321_b00b_4204cb01128d.png` |
| `gyms/[gymId]` | 660 | 9 | 91 | 0 | 0/0 | 0 |  | `shots/gyms_gymId_ws_gyms_d744ee4b_e70a_4c13_bb11_b79f07041fcf_id_from_API_no_a_link_on_list_page.png` |
| `subscriptions/plans/[planId]` | 638 | 8 | 60 | 0 | 0/0 | 0 |  | `shots/subscriptions_plans_planId_ws_subscriptions_plans_8da57468_7eef_4eef_a719_90840dfbf776.png` |
| `users/[userId]` | 638 | 16 | 34 | 0 | 0/0 | 0 |  | `shots/users_userId_ws_users_d6dd5c28_06b9_4677_b656_e04ef9a1869d.png` |
| `videos/[videoId]` | 655 | 12 | 14 | 0 | 2/0 | 0 | CSP blocks the HLS manifest (#15, local env) | `shots/videos_videoId_ws_videos_d3071fb0_1e29_4dc4_97b3_81720ad52f8a_id_from_API_no_a_link_on_list_page.png` |
| bogus `/groups/0000…` | 609 | 9 | 7 | 2 (404) | 2/0 | 0 | inline "Группа не найдена" (good) | `shots/bogus_id_groups_00000000_0000_0000_0000_000000000000.png` |
| bogus `/users/0000…` | 613 | 10 | 8 | 1 (404) | 1/0 | 0 | inline "Участник не найден" (good) | `shots/bogus_id_users_00000000_0000_0000_0000_000000000000.png` |

**Totals:** 40 real pages crawled. 0 HTTP errors, 0 page errors, 0 error-boundary renders, 0 stuck spinners. No `undefined`, `NaN`, `Invalid Date` or `[object Object]` appeared in any page text. Median load 638 ms; maximum 889 ms (`/analytics/churn`).

## Server behind the admin

- **N+1:** none found on read paths. List handlers batch with `in:` or `include`; audit labels resolve in one batch per entity type (`domains/audit/services/audit.service.ts:299-423`).
- **Paginated:** audit (`perPage` ≤100, used by `/ws/audit`), members (`perPage=50` on users), payments (≤100), attendance sessions (≤100), awaiting-payment (`take: 200`).
- **Bounded:** schedule is limited to a 90-day window; videos are paginated at `perPage=30`.
- **Not paginated:** groups (#1), at-risk members, renewal candidates, rank readiness, events, analytics churn and cohorts (#10).
- **Analytics reads** come from snapshot tables, so they are cheap. **Refresh** is synchronous with no throttle (#3).
- **Global throttler:** prod 20/s and 600/min per user (`app.module.ts:680-701`, per-user bucket in `shared/guards/club-throttler.guard.ts`). No analytics route has its own `@Throttle`.

## Depth compared with club-management products

**Solid** (on a par with or ahead of Moyklass, Altegio, Glofox for a martial-arts or fitness club):
- **Schedule:**
  - day, week, month, year and list views;
  - drag to move or resize, with undo;
  - one-off and weekly classes, cancellations and group vacations;
  - coach substitutions;
  - per-group booking mode, capacity, booking window and cancellation deadline;
  - **waitlist with automatic promotion**;
  - late-cancel and no-show "burn" rules.

  Sources: `ClassBookingStatus` enum, `features/schedule/calendar/*`, `shots/flow_schedule_open_class.png`, settings toggles.
- **Memberships:**
  - plans with price, duration, class count, trial, start-on-first-visit and direction scoping;
  - freezes and member freeze requests;
  - manual payment marking (cash, transfer, card in the club);
  - "awaiting payment" and "renewal candidates" lists.

  Sources: `Plan`/`Subscription`/`SubscriptionFreeze*` models; `users/[userId]` buttons in `buttons.json`.
- **Online payments:** ЮKassa or Stripe, money goes straight to the club, **54-ФЗ receipt data** (VAT, payment subject, payment method), webhook URL helper. Screenshot `shots/ws_payments.png`.
- **Retention analytics:** above what most competitors ship.
  - at-risk list with contact logging;
  - churn score;
  - cohort retention at 1/2/3/6 months;
  - per-coach retention and renewals;
  - schedule occupancy with recommendations;
  - revenue forecast.

  Screenshots `shots/ws_analytics_*.png`.
- **Multi-location, directions and roles:** gyms, directions with managers, staff roles, coaches' visibility settings.
- **Families:** guardians and dependents ("Добавить ребёнка").
- **Ranks and gradings:** ladders, readiness ("Готовы · 51"), grading sessions. Uncommon in generic CRMs and a real differentiator for martial arts.
- **Engagement:** events with registration, waitlist and payment; announcements with targeting, scheduling and pinning; achievements; leaderboard; an LMS (courses, chapters, video, subtitles, timestamps); public page.
- **Operations hygiene:** audit log; CSV exports (members, renewals, attendance, revenue); Excel/CSV club import; realtime updates; 2FA for platform staff; consent records.

**Shallow or missing** (what owners of these products expect and switch for):

| Capability | State here | Evidence |
|---|---|---|
| Lead / prospect CRM: trial requests → pipeline → conversion | **Missing at club level.** `DemoRequest` is ClubSpace's own sales funnel (`features/platform/PlatformDemoRequests.spec.tsx`). Trial exists only as a plan flag. | Prisma model list has no Lead model |
| Recurring member billing / autopay | **Missing.** Autopay exists only for the club paying ClubSpace; member subscriptions are one-off payments. | `features/billing/BillingPaymentSection.tsx:40-50` (platform), `SubscriptionSource { MANUAL GATEWAY }` |
| Discounts, promo codes, family/sibling pricing, gift cards | **Missing.** `Plan` has only `price`. | `model Plan` fields |
| Retail / POS / inventory (gear, drinks) | **Missing** | no Product/Order models |
| Coach payroll / per-class rates / commissions | **Missing**, although the coach analytics data to compute it exists | no salary/payroll model; `analytics/coaches` |
| Finance: cash desk, expenses, P&L, revenue by method/coach on screen | **Shallow:** dashboard revenue widgets, forecast, "Выручка (CSV)" export and an online-payments list only | `workspace/[workspaceId]/page.tsx:208,341,659`; `settings/page.tsx:385` |
| Debt / arrears | Partial ("awaiting payment" list, capped at 200) | `list-awaiting-payment.handler.ts:42-49` |
| SMS / WhatsApp reminders and campaigns | **Missing.** Channels are push, e-mail and Telegram. | `TelegramLink`, `EmailTemplate`, push models; no SMS provider |
| Member contracts / e-signature | Personal-data consent only; `club-legal` covers the club accepting ClubSpace terms | `features/club-legal/*` |
| Admin e2e / regression safety | None (see #7) | `apps/` |

## Solid (keep as is)

- **No crashes:** zero runtime errors across 40 pages. Error boundaries (`app/error.tsx`, `global-error.tsx`) report to Sentry. Bad ids degrade to inline messages, and the owner on `/platform` gets a clear notice instead of a 403 page.
- **One error path:** `errorMessage()` with the server's message first (223 uses). Fix the "Network Error" fallback (#6) and it is complete.
- **Type-safe end to end:** generated OpenAPI client, zero `any`, zero TODO/FIXME.
- **Updates wait for the server:** writes are awaited and the data is reloaded. Optimistic updates are used only where they are safe, and they roll back: achievement reorder (`achievements/page.tsx:183-193`) and video playlists, with a re-entrancy guard (`videos/[videoId]/page.tsx:355-370`).
- **Sensible refresh:** realtime updates on 10 screens; at-risk refresh throttled to 60 s (`shared/lib/at-risk.ts:28`).
- **Client validation:** native `required` and disabled submit stopped empty submits in every create form I tried.
- **Server reads are well batched** (no N+1). Audit, members, videos, payments and attendance are paginated. Schedule is window-bounded.
- **Auth:** HttpOnly refresh cookie, access token kept in memory, Web Locks so two tabs don't both use the same refresh token. Token reuse ends the session; I triggered this myself by reusing a stale saved session, and it worked as designed.
- **Tests:** 500 passing, ~30% line coverage, concentrated in schedule (65%), content (68%) and `shared/lib` (89%), which are the most complex areas.

## Checks the main agent may want to run

- `npx nx test @clubspace/admin --coverage --coverageReporters=text-summary` to reproduce the coverage numbers.
- Re-run the crawl: start the admin on :4200, then `node /tmp/cs-rec/signin.mjs owner@academy.demo /tmp/cs-rec/state-audit.json && node /tmp/cs-rec/audit-crawl.mjs`.
