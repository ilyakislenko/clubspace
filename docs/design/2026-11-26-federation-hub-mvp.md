# Federation hub MVP: organizations over clubs

Status: **design** · 2026-11-26 · base: `main` @ `d434461c`
Parent: [concept](../strategy/concept.md) §2.10 («Не реализовано: сети из разных юрлиц и федерации»), §3 item 5;
[master prompt](../strategy/master-prompt.md) L21, L33, L91–92; [competitors](../strategy/competitors.md) L212.
Siblings: [requests inbox](2026-11-15-requests-inbox.md), [club messages](broadcast-and-direct-messages.md) (shares
`quiet-hours.ts`). File:line references are as of `d434461c`. The owner was asleep; every owner-level choice is in
§10 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас ClubSpace знает только клубы. Федерации или сети над клубами нет, поэтому главному тренеру федерации
нечего показать. В этом документе — минимальный «штаб федерации», который можно показать уже сейчас.

1. **Федерация — отдельный кабинет в админке** (`/org/<id>`, 7 пунктов меню). Клубы остаются самостоятельными:
   их данные, ученики, деньги и настройки принадлежат клубу.
2. **Клуб вступает только с согласия владельца:** федерация приглашает по коду клуба, владелец принимает в
   «Настройки → Федерация». Выйти можно в любой момент одной кнопкой.
3. **Роли:** администратор федерации — всё; тренер федерации — реестр, календарь, стандарты (без управления
   клубами и командой).
4. **«Клубы»:** ученики, активные ученики, были на занятиях за 30 дней, новые за 30 дней, удержание новичков за
   3 месяца — по тем же формулам, что в самом клубе. Деньги федерация не видит, пока клуб сам не откроет каждую
   цифру отдельно.
5. **Реестр поясов:** пояса из клубов федерации с пометкой «подтверждён клубом X» — только имя, пояс, клуб и
   дата, и только тех, кто сам согласился (за ребёнка — родитель); согласие отзывается в приложении (152-ФЗ).
6. **Объявления федерации** тренерам клубов и по желанию — в ленту учеников (клуб может запретить).
7. **Стандарт лестницы поясов:** клуб берёт его как образец — копия, которую клуб правит сам.
8. **Календарь:** турниры, семинары, аттестационные дни; ученики записываются в приложении, тренер может
   записать своих. Запись бесплатная, взнос — текстом, оплата вне приложения.
9. **Демо:** «Федерация БЖЖ Томской области» с ACADEMY и новым сгенерированным клубом «Беркут», вход
   `federation@academy.demo`.

Не входит (план в §12): сетки турниров, взвешивание и судейство, членские взносы, медицинские допуски,
заявочные формы для спорткомитета.

## Problem

1. **No layer above a club.** No `Organization`/`Network`/`Federation` model; everything is rooted at `Workspace`
   (`schema.prisma:93`). The only cross-club console is the platform owner's (`features/platform/platform.controller.ts:170-171`,
   `shared/guards/super-admin.guard.ts:19`). The strategy promises «штаб публикует… стандарты аттестации… реестр
   аттестаций» (`concept.md:169-172`, `master-prompt.md:21,33`) as future work (`master-prompt.md:91-92`).
2. **Club isolation is absolute by design** (`resolveRequestWorkspaceId`, conventions §1; `concept.md:15-16`):
   a federation coach could see a club only as its staff — i.e. with its money, roster and settings.
3. **Belts are club-local.** `RankPromotion` (`schema.prisma:2510`) is an append-only per-club history
   (`domains/ranks/services/rank.service.ts:30-31`); ladders are per club with no template or copy
   (`RankLadder` `:2449`, `RankLevel` `:2476`).
4. **Events are club-only.** `WorkspaceEvent` (`:925`) has no wider visibility; registration requires membership
   (`event-registrations.controller.ts:86-91`); paid tickets feed the club's revenue glossary
   (`domains/payments/journal.ts:133`), so an inter-club event can't be a club event.
5. **Cross-entity sharing needs a basis.** The club is the operator, the platform processes on instruction
   (`docs/legal/README.md` «Вопросы юристу», DPA `dpa-2026-11-01.tsx:399`); a federation is a third party.
   `ConsentKind` = `PERSONAL_DATA | DEPENDENT_DATA` only (`schema.prisma:2945-2948`).

## Goal / non-goals

**Goal.** A federation head coach opens one console and sees the member clubs with headline numbers, a
searchable registry of belts confirmed by those clubs, one calendar of federation events members of every club
can sign up for, a channel to the clubs' staff, and a standard ladder clubs can adopt. Each club joins by its
owner's decision, controls what it shares and can leave any time; no club gains access to another.

**Non-goals (MVP):** tournament software, fees, medical documents, sports-committee paperwork (§12); org billing
(free); a public athlete profile; live template sync or programme/course inheritance; org-level AI/MCP; «branch»
management of one legal entity (directions cover it, `concept.md:160-167`).

**Ground rules:** as in the [admin-cleanup spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer) —
additive `db push`, `@unique` only on new tables, authorize in the handler, `serialize*`, unique names, contract
regen, people counts only from `domains/metrics/*`; sport-agnostic code (the org's `WorkspaceType` picks only the
vocabulary; BJJ content is demo-only); UI rules (one primary, row tap opens, ≤ 1 «⋯», side panels, formal «вы»).

## 1. The rules

- **Tenancy.** An `Organization` is not a tenant of people. It owns only its own rows: staff, club links,
  announcements, events, templates. Everything it shows about a club is computed on read by an org endpoint,
  through an allow-listed reader (§3.1). Org endpoints never call workspace routes, and org staff never get a
  `WorkspaceMember` row.
- **Membership lifecycle** (`OrganizationClub.status`):
  - `INVITED` (org admin, by the club's join code) → `ACTIVE` (the club **owner** accepts) or `DECLINED`
    (owner or club admin);
  - `ACTIVE` → `LEFT` (a club admin, any time) or `REMOVED` (an org admin);
  - re-inviting a `LEFT`, `DECLINED` or `REMOVED` club reuses the row (back to `INVITED`).

  A club may belong to several organizations, for example a regional federation and an affiliation network.
- **What a club shares, by default and toggle** (set by club admins on «Настройки → Федерация»):

  | Data | Default | Toggle |
  |---|---|---|
  | Club name, city, logo, public contacts (`aboutContacts`) | shared | — (part of membership) |
  | Headline numbers: students, active students, attended 30 d, new 30 d, newcomer retention 3 m | shared | — |
  | `mrr` «Регулярный доход в месяц», `revenue_30d` «Выручка за 30 дней» | **off** | `shareMrr`, `shareRevenue30d` |
  | Belt registry rows of consenting members | on | `shareRegistry` |
  | Org announcements in the members' feed | on | `allowMemberAnnouncements` |
  | Org events visible and bookable by members | on | `allowMemberEvents` |

- **Person-level consent (152-ФЗ).** A member's name, belt, club and dates reach the org only with consent kind
  `ORGANIZATION_SHARING` for *that* org. The consent covers the registry and event registrations. A guardian
  gives it for a child (`dependentId`, the `DEPENDENT_DATA` pattern, `schema.prisma:2967-2970`). Withdrawal
  stamps `withdrawnAt`, and since the registry is computed live, the person disappears at once.

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

Condensed notation: every model also has `id String @id @default(uuid()) @db.Uuid`, `createdAt`, and `updatedAt`
where edited; FKs are `@db.Uuid` with the `onDelete` noted; enum values one per line in the schema.

```prisma
enum OrganizationRole           { ORG_ADMIN ORG_COACH }
enum OrganizationClubStatus     { INVITED ACTIVE DECLINED LEFT REMOVED }
enum OrganizationEventKind      { COMPETITION SEMINAR CAMP GRADING MEETING OTHER }
enum OrganizationAudience       { STAFF STAFF_AND_MEMBERS }
enum OrgEventRegistrationStatus { BOOKED CANCELLED }

model Organization {
  key String @unique @db.VarChar(50)   name String @db.VarChar(255)   type WorkspaceType @default(CUSTOM) // vocabulary only
  city String? @db.VarChar(120)   description String? @db.Text   logoKey String? @db.Text // storage-keys.ts rules
  timezone String @default("Europe/Moscow") @db.VarChar(64)   isDemo Boolean @default(false)   isActive Boolean @default(true)
}
model OrganizationMember {            // org staff (a global User)
  organizationId (Cascade)   userId → User (Cascade)   role OrganizationRole   invitedById String? @db.Uuid
  @@unique([organizationId, userId])  @@index([userId])
}
model OrganizationClub {
  organizationId (Cascade)   workspaceId → Workspace (Cascade: a deleted club leaves)
  status OrganizationClubStatus @default(INVITED)   invitedById String?   invitedAt DateTime @default(now())
  decidedById String?   decidedAt DateTime?
  shareRegistry Boolean @default(true)   shareMrr Boolean @default(false)   shareRevenue30d Boolean @default(false)
  allowMemberAnnouncements Boolean @default(true)   allowMemberEvents Boolean @default(true)
  @@unique([organizationId, workspaceId])  @@index([workspaceId, status])
}
model OrganizationAnnouncement {
  organizationId (Cascade)   authorId? (SetNull)   authorName String @db.VarChar(255)
  title String @db.VarChar(255)   body String @db.Text   audience OrganizationAudience @default(STAFF)
  publishedAt DateTime?        // null = draft, future = scheduled
  staffNotifiedAt DateTime?    // set by the dispatcher once every club got its staff push (quiet hours)
  @@index([organizationId, publishedAt])  @@index([publishedAt, staffNotifiedAt])
}
model OrganizationLadderTemplate {
  organizationId (Cascade)   name String @db.VarChar(255)   audience String? @db.VarChar(64) // as RankLadder.audience
  version Int @default(1)      // +1 on every level edit; shown to adopters
  isActive Boolean @default(true)   levels OrganizationLadderTemplateLevel[]
  @@index([organizationId])
}
model OrganizationLadderTemplateLevel { // mirrors RankLevel
  templateId (Cascade)   name String @db.VarChar(255)   order Int   color String? @db.VarChar(16)
  maxStripes Int @default(0)   requirements String? @db.Text   minVisits Int?   minWeeks Int?
  @@unique([templateId, order])
}
model OrganizationEvent {
  organizationId (Cascade)   kind OrganizationEventKind @default(OTHER)   title String @db.VarChar(255)   description String?
  startAt DateTime   endAt DateTime?   timezone String @db.VarChar(64)   place String?   address String?
  hostWorkspaceId? (SetNull)   // «принимает клуб X»
  audience OrganizationAudience @default(STAFF_AND_MEMBERS)
  capacity Int?   registrationOpen Boolean @default(true)   registrationClosesAt DateTime?
  feeNote String? @db.VarChar(255) // «Взнос 1 500 ₽ на месте» — text only, no money in the app
  publishedAt DateTime?   createdById? (SetNull)
  @@index([organizationId, startAt])
}
model OrganizationEventRegistration {
  eventId (Cascade)   userId → User (Cascade)   // the athlete: a child, not the guardian
  workspaceId → Workspace (Cascade)               // the club registered through (ACTIVE in the org)
  status OrgEventRegistrationStatus @default(BOOKED)   bookedById String?   cancelledAt DateTime?
  @@unique([eventId, userId])  @@index([workspaceId])
}
```

Existing tables gain nullable columns or enum values only:
- `ConsentKind` gains `ORGANIZATION_SHARING`.
- `ConsentRecord.organizationId String? @db.Uuid` + `@@index([organizationId, kind])`.
- `RankLadder.templateId String? @db.Uuid`, `RankLadder.templateVersion Int?`, `RankLevel.templateLevelId String? @db.Uuid`
  (plain ids, no FK: a copy outlives the template).
- `AuditEvent.organizationId String? @db.Uuid` + `@@index([organizationId, createdAt])`.

No backfill (`deploy/update.sh` untouched).

## 3. Server

### 3.1 Domain — `apps/server/src/domains/organizations/`

- **`org-access.ts`** — the one answer to «who may do what in the org»: `OrgRbacService.resolveOrgScope({ userId,
  organizationId, isSuperAdmin })` → `{ role }` (super admin = `ORG_ADMIN`; not a member → `NotFoundError`, no
  existence leak); `assertOrgAdmin` / `assertOrgStaff`; `activeClubIds(prisma, orgId)` (`ACTIVE` links only).
- **`club-metrics.ts`** — `loadOrgClubMetrics(prisma, orgId, now)` per active club: `countStudents`,
  `countActiveStudentsMany` (one query, `domains/metrics/active-students.ts:25`), `countStudentsAttended` and
  `countNewStudents` (`students.ts:48`) since 30 d, `newcomerRetention3m` = offset 3 of
  `averageRetention(loadCohortReport(…whole club).cohorts)` (`domains/analytics/cohorts.ts:125`,
  `analytics-reports.ts:63`); money only where opted in — `mrr` (`loadMonthlyRecurringIncome`), `revenue_30d`
  (`computeRevenue` over `loadSales` + `loadRefunds`). Totals: counts summed, retention weighted by `eligible`,
  money over opted-in clubs («по N из M клубов»). Redis `org-metrics:<orgId>` 10 min (leaderboard pattern).
- **`registry.ts`** — `loadRegistry(prisma, { orgId, q, workspaceId?, templateLevelId?, awardedFrom?, awardedTo?,
  curPage, perPage })`: the latest `RankPromotion` per `(userId, ladderId)` in `ACTIVE` + `shareRegistry` clubs,
  for people with an un-withdrawn `ORGANIZATION_SHARING` consent for this org (own, or a guardian's with
  `dependentId`). Row = `{ personKey, personName, levelName, levelColor, stripes, ladderName, clubName, awardedAt
  (date), templateLevelName? }` — **no** user id, contact, birth date, photo or awarding coach. `ILIKE` name
  search. `personKey` = HMAC(`userId`, `orgId`) for the history read; no global id leaks.
- **`consent.ts`** — `ORG_SHARING_CONSENT_VERSION`, the text (name, belt, club, promotion dates, federation event
  registrations; revocable in the app), `hasOrgConsent` / `grantOrgConsent` / `withdrawOrgConsent`.
- **`data-source.spec.ts`** — grep pin: `features/organizations/**` reads club tables only through
  `domains/organizations/*` and `domains/metrics/*` (style of `shared/access/workspace-id-source.spec.ts`).

### 3.2 Org console — `features/organizations/` (route prefix `orgs/:organizationId`)

Guards `AuthGuard, OrganizationMemberGuard` (new: resolves membership like `WorkspaceMemberGuard`; super admin
passes). Each route carries `@OrgRoles(ORG_ADMINS | ORG_STAFF)`, and the handler repeats it with
`assertOrgAdmin` / `assertOrgStaff`. `route-tier-consistency.spec.ts` gains the pair rule for `@OrgRoles`.

| Route | Tier | Name |
|---|---|---|
| `GET orgs/mine` (no `:organizationId`; lists my orgs) | any user | `listMyOrganizations` |
| `GET orgs/:id` · `PATCH orgs/:id` (name, city, description, logo, timezone; `ExpectedUpdatedAtField`) | staff · admin | `getOrganization` · `updateOrganization` |
| `GET orgs/:id/clubs` (links + metrics) | staff | `listOrganizationClubs` |
| `POST orgs/:id/clubs/invitations {joinCode}` | admin | `inviteClubToOrganization` |
| `DELETE orgs/:id/clubs/:linkId` (revoke invite / remove) | admin | `removeClubFromOrganization` |
| `GET orgs/:id/registry` · `GET orgs/:id/registry/:personKey` | staff | `searchOrganizationRegistry` · `getOrganizationRegistryPerson` |
| `GET/POST/PATCH/DELETE orgs/:id/announcements[/:aid]` | admin (list: staff) | `listOrgAnnouncements` … `deleteOrgAnnouncement` |
| `GET/POST/PATCH/DELETE orgs/:id/events[/:eid]` | staff | `listOrgEvents` … `deleteOrgEvent` |
| `GET orgs/:id/events/:eid/registrations` | staff | `listOrgEventRegistrations` |
| `GET/POST/PATCH/DELETE orgs/:id/ladder-templates[/:tid]` (+ levels) | staff | `listOrgLadderTemplates` … |
| `GET/POST/DELETE orgs/:id/members[/:userId]` `{email, role}` | admin | `listOrgMembers` · `addOrgMember` · `removeOrgMember` |
| `GET orgs/:id/audit` | admin | `listOrgAuditEvents` |

- The invite looks the club up by its join code, the same lookup as `GET public/clubs/by-code/:code`
  (`public-clubs.controller.ts:56`). It shows the club name before confirming and notifies the owner.
- `addOrgMember` creates the user by e-mail when missing, the way `invite-workspace-member.handler.ts:183`
  does, and e-mails «Вас добавили в команду федерации».
- The last `ORG_ADMIN` can't be removed (400).
- Registrations output: name, club, status, `bookedBy` («записал тренер» / «сам»), and the current belt only when
  that person is visible in the registry.

**Platform:** `POST platform/organizations {name, key, type, city, adminEmail}` (`SuperAdminGuard`, next to
`POST platform/workspaces`, `platform.controller.ts:202`) and `GET platform/organizations`. Creating an org is a
platform action in the MVP (no self-serve).

### 3.3 Club side — `features/club-organizations/` (route prefix `workspaces/:workspaceId`)

| Route | `@Roles` | Handler | Name |
|---|---|---|---|
| `GET organizations` (links, any status but `REMOVED`) | `CLUB_ADMINS` | `assertClubAdmin` | `listClubOrganizations` |
| `POST organizations/:linkId/accept {sharing}` | `CLUB_ADMINS` | `assertClubAdmin` + `userId === workspace.ownerId` (or super admin) | `acceptOrganizationInvite` |
| `POST organizations/:linkId/decline` | `CLUB_ADMINS` | `assertClubAdmin` | `declineOrganizationInvite` |
| `PATCH organizations/:linkId/sharing` | `CLUB_ADMINS` | `assertClubAdmin` | `updateOrganizationSharing` |
| `POST organizations/:linkId/leave` | `CLUB_ADMINS` | `assertClubAdmin` | `leaveOrganization` |
| `GET organization-ladder-templates` (of the club's active orgs) | `COACHING_ROLES` | lead scope | `listAdoptableLadderTemplates` |
| `POST rank-ladders/from-template {templateId, directionId?}` | `COACHING_ROLES` | `assertCanManageDirection` (ladder = direction-owned) | `createRankLadderFromTemplate` |
| `GET me/organizations` (active orgs of this club, my consent) | any member, act-as | — | `listMyClubOrganizations` |
| `PUT me/organizations/:orgId/consent {granted}` | any member, act-as | membership + org active in this club | `setMyOrganizationConsent` |
| `GET org-events` (published, `STAFF_AND_MEMBERS`, `allowMemberEvents`) | any member | — | `listClubOrgEvents` |
| `POST org-events/:eventId/registrations {userId?}` | any member; `userId` → `COACHING_ROLES` + `assertCanWriteGroup` on a group of that student | see below | `registerForOrgEvent` |
| `DELETE org-event-registrations/:registrationId` | self / guardian / the booking coach | — | `cancelOrgEventRegistration` |

- `CLUB_ADMINS` routes join the pinned list in `route-tier-consistency.spec.ts`.
- `from-template` copies levels into a new `RankLadder` + `RankLevel`s with `templateId`, `templateVersion`,
  `templateLevelId`; the club edits freely; the ladders page notes «Стандарт федерации обновлён до версии N».
- **Registration** (one `$transaction`, `SELECT … FOR UPDATE` on the event as `event-registration.service.ts`
  `lock`): club `ACTIVE` with `allowMemberEvents`; event published, `registrationOpen`, before
  `registrationClosesAt` and `startAt`; `BOOKED` < `capacity` (no waitlist: «Мест нет»); the athlete consented
  (else 409 `ORG_CONSENT_REQUIRED` — the app asks first; a coach may register only consenting students);
  idempotent on `(eventId, userId)`.
- `get-feed` (`features/manage-announcements/get-feed.handler.ts`) merges published `STAFF_AND_MEMBERS` org
  announcements of active orgs with `allowMemberAnnouncements`, tagged `source: { kind: 'organization', name }`
  (optional field on `AnnouncementOutputSchema`).

### 3.4 Notifications, quiet hours, audit, realtime

- **Kinds:** `org.club_invited` → the club owner (push + inbox + e-mail; mute-exempt, a membership decision);
  `org.club_joined|left` → org admins; `org.announcement` → owners and `STAFF_ROLES` of active clubs (metadata
  `{ organizationId, workspaceId }`, mutable, category `announcementsEnabled`); `org_event.registered_by_club` →
  the athlete / guardians. No member push for org announcements (feed only).
- **Quiet hours:** staff pushes go from the minute job (`RemindersService`, like scheduled announcements,
  `reminders.service.ts:125`) for `publishedAt ≤ now, staffNotifiedAt = null`, skipping clubs where
  `isQuietHour(now, club tz)` (`domains/notifications/quiet-hours.ts`, shared with the messages design) until
  09:00; per-club claim `org.announcement` / `<id>:<workspaceId>`; `staffNotifiedAt` once all clubs are done.
- **Audit:** org side with `organizationId`, `workspaceId: null` (`org.update`, `org.inviteClub`, `org.removeClub`,
  `org.member.add|remove`, `org.announcement.*`, `org.event.*`, `org.template.*`); club side with both ids
  (`org.acceptInvite|declineInvite|updateSharing|leave`, `rankLadder.fromTemplate`); consent evidence =
  `ConsentRecord`. **Realtime:** club side `invalidate(workspaceId, ['organizations'])`; the console refetches on
  focus (no org rooms).

## 4. Admin UI

### 4.1 Org console — `app/(dashboard)/org/[orgId]/**`

`/org/<id>` is a third top-level area beside `/workspace/<id>` and `/platform`. Org staff are not club staff, so
the workspace sidebar can't host it, and `/platform` is the platform owner's. The layout is
`org/[orgId]/layout.tsx` with `OrgGate`, which reads `GET orgs/:id` and shows «Раздел доступен команде
федерации» otherwise. `org-sidebar.tsx` mirrors `workspace-sidebar.tsx` (`navGroups` with `access: "orgAdmin" |
"orgStaff"`), and the vocabulary comes from `vocabularyForWorkspaceType(org.type)`.

| # | Item (title = label) | Route | Access | Content |
|---|---|---|---|---|
| 1 | Клубы | `` | staff | Table: club · city · Ученики · Активные ученики · Были за 30 дней · Новые за 30 дней · Удержание новичков (3 мес.) · money columns only if any club shares (empty cell «не открыт»). Totals row. Pending invites as rows with «Приглашён» in muted text. Primary «Пригласить клуб» (admin) → panel: code → club preview → «Отправить приглашение». Row tap → side panel: contacts, numbers, what the club shares, «⋯ → Исключить из федерации» (confirm: «Клуб перестанет видеть …, реестр его учеников скроется») |
| 2 | Реестр поясов | `registry` | staff | Search box first; filters club, standard level, date range; rows name · belt (colour dot + name + stripes) · «подтверждён клубом X» · date. Row tap → panel with the person's history. Footer: «Показаны ученики, давшие согласие федерации» |
| 3 | Календарь | `events` | staff | List by month; primary «Добавить событие» → `OrgEventFormSheet` (kind, dates in the org zone, place, host club, audience, capacity, registration, fee note); row tap → panel with registrations grouped by club, CSV «Скачать список» |
| 4 | Объявления | `announcements` | staff (write: admin) | As the club page: list + side panel form; audience «Тренерам клубов» / «Тренерам и ученикам» |
| 5 | Стандарты | `ladders` | staff | Templates list; panel edits levels (reuses the club ladder level editor components); «Принят в клубах: ACADEMY (v2), Беркут (v1)» |
| 6 | Команда | `team` | admin | Org staff with role; primary «Добавить» (e-mail + role); «⋯ → Убрать» |
| 7 | Настройки | `settings` | admin | Profile (name, city, description, logo, time zone; dirty guard, `expectedUpdatedAt`) + tab «История изменений» |

The picker `(dashboard)/workspaces/page.tsx:25-130` gains a «Федерации» block from `GET orgs/mine`. An account
with exactly one org and no admin clubs is sent to `/org/<id>`, mirroring the single-club redirect at `:63-66`.
The account menu «Сменить клуб» label becomes «Сменить клуб или федерацию» only when the user has an org.
The admin e2e `role-matrix.ts` gains an org table (`federation@academy.demo`: all 7; a club owner: 403 notice on
`/org/<id>`).

### 4.2 Club side

- **«Настройки → Федерация»** (`settings/federation`, club admin, `ClubAdminGate` via the settings layout) is a
  new entry in `features/settings/SettingsNav.tsx`; there is no sidebar change. It renders only when the club
  has any link, so a club never invited sees no item.
  - `INVITED`: a card «Федерация «…» приглашает клуб» listing what will be shared (the §1 table) with the toggles
    prefilled. The owner gets primary «Принять» and secondary «Отклонить». A non-owner admin sees «Принять может
    только владелец клуба».
  - `ACTIVE`: the sharing toggles (save per toggle, audited) and «⋯ → Выйти из федерации» (confirm: «Федерация
    перестанет видеть цифры клуба, реестр и записи ваших учеников на её события»).
- **«Пояса → Лестницы»** (`ranks`): when the club has active orgs with templates, a block «Стандарты федерации»
  lists them with «Взять за основу» → a direction picker → a copy that opens in the ladder editor.
- **«Новости и события → Объявления»**: org items in the staff list read «От федерации «…»», read-only.

## 5. Mobile

- **Consent:** `ClubSettingsScreen` (`features/clubs/ClubSettingsScreen.tsx`) gains «Федерация «…»» with a switch
  «Показывать мой пояс и записи федерации», the consent text and the policy link; a one-time Home card «Клуб
  вступил в федерацию «…»» → «Разрешить» / «Не сейчас» (dismissal stored locally per org). Acting as a child,
  the guardian consents for the child.
- **Events:** `features/schedule/EventsScreen.tsx` gets «События федерации «…»» (`GET org-events`) with
  «Записаться» / «Отменить запись»; no consent → the consent sheet first; full → «Мест нет»; fee note as text;
  «Федерация увидит ваше имя и клуб». Staff: «Записать учеников» → a picker of consenting own-group students.
- **Ranks / feed:** `MyRanksScreen` shows «В реестре федерации «…»» when visible there; `AnnouncementsScreen`
  renders `source` as a small «Федерация «…»» line.
- `shared/api/organizations.ts`; `notification-route.ts`: `org.club_invited` → `null` (decided in the admin),
  `org.announcement` → `Announcements`, `org_event.registered_by_club` → `Events`.

## 6. MCP / AI

There is no org-level MCP in the MVP; AI tokens are per club. The club's `club_overview` (`features/mcp/tools/
club-tools.ts:182`) gains `organizations: [{ name, status }]` for club admins, read-only. Recorded as a next step
in §12.

## 7. Demo generator

- **New demo club «Беркут»** (BJJ content, sport-agnostic code): `domains/demo/berkut-demo.accounts.ts` +
  `berkut-demo.plan.ts` on `DemoClubPlan`, `demoUuid` and the writer (`demo-club.writer.ts:21`), the Ритм pattern
  (`ritm-demo.plan.ts:313`). Key `berkut-demo`, `GRAPPLING`, `Asia/Tomsk`, code `BERKUT24`; 1 gym («Спортзал
  «Олимп»», fictional address), 4 groups (Взрослые утро/вечер, Дети 7–10, Подростки), ~90 students incl. 25
  children, 220 days of history, ladders adopted from the federation template; accounts `owner@berkut.demo`,
  `coach@berkut.demo`; phones `+7 900 3xx-xx-xx`. `DEMO_CLUB_IDS` (`demo-clubs.ts:21`) gains `'berkut'`.
- **Org** — `domains/demo/demo-organization.ts` `seedDemoOrganization(prisma, now)`, idempotent, after the clubs
  are seeded or reset (`demo-club.service.ts:80-96`):
  - «Федерация БЖЖ Томской области», key `tomsk-bjj-federation-demo`, `GRAPPLING`, `Asia/Tomsk`, `isDemo`;
  - admin `federation@academy.demo` (Николай Белов, «Президент федерации (демо)») in `DEMO_ACCOUNTS`
    (`demo-accounts.ts:36`, key `federation`); `isDemoOnlyAccount` (`demo-access.ts:19-42`) also requires «no org
    membership outside a demo org»;
  - links: ACADEMY `ACTIVE` (registry on, money off), Беркут `ACTIVE` (registry + `shareMrr` on — shows the opt-in);
    Ритм not linked (another discipline; it is the live «пригласить по коду» demo);
  - templates «Пояса (взрослые)» v2 (белый → чёрный, 4 полоски), «Пояса (дети)» v1; ACADEMY's BJJ ladder linked at
    v1 (shows «обновлён до версии 2»);
  - consents for ~85% of adults and ~60% of children (by guardians) → ~300 registry rows;
  - events: «Открытый турнир Томской области» (COMPETITION, in 24 days, host ACADEMY, capacity 200, 23
    registrations from both clubs, «Взнос 1 500 ₽ на месте»), «Семинар для тренеров: правила и судейство»
    (SEMINAR, STAFF), «Аттестационный день федерации» (GRADING, in 45 days);
  - announcements «Положение о турнире опубликовано» (STAFF_AND_MEMBERS), «Собрание тренеров 5 декабря» (STAFF).
- `docs/demo.md`: account row, «Федерация» section, 5-minute script «Клубы → Реестр (поиск «Иванов») →
  Календарь → турнир → записи по клубам → пригласить «Ритм» по коду».

## 8. Tests

Server unit:
- `org-access.spec.ts`: non-member → 404, org coach vs admin, super admin.
- `club-metrics.spec.ts`: values equal the club's own functions on a fixture; money only with opt-in; totals and
  weighted retention; `LEFT`/`INVITED` excluded.
- `registry.spec.ts`: consent own / guardian / withdrawn; club `shareRegistry` off; club `LEFT`; latest promotion
  per ladder; no forbidden fields in the serialized row; `personKey` stable per org and different across orgs.
- Handler specs (each refusal; owner bypass on club routes): `accept-organization-invite` (non-owner admin 403,
  owner passes, non-`INVITED` 409); `leave-organization`; `update-organization-sharing`;
  `invite-club-to-organization` (bad code 404, already active 409, org coach 403); `add-org-member` (last admin);
  `register-for-org-event` (capacity race → one «Мест нет», no consent 409, club not active 404, foreign-group
  student by a coach 403, closed/started 400); `create-rank-ladder-from-template` (provenance, direction scope
  403); `set-my-organization-consent` (act-as writes `dependentId`).
- `get-feed.handler.spec.ts` (org items only with the switch + active link); `reminders.service.spec.ts` (quiet
  clubs skipped); `notification-mute.spec.ts` (`org.club_invited` exempt); `data-source.spec.ts`;
  `route-tier-consistency.spec.ts` (`@OrgRoles` pairs, `CLUB_ADMINS` list); demo `berkut-demo.plan.spec.ts`
  (determinism, counts), `demo-organization.spec.ts` (idempotent, `isDemoOnlyAccount`).

Server e2e `apps/server-e2e/src/organizations/`:
- `federation-membership.e2e-spec.ts`: `org admin invites a club by code and only the club owner can accept`;
  `club admin leaves and the org loses its numbers and registry rows at once`; `org staff cannot call any
  workspace route of a member club`.
- `federation-metrics.e2e-spec.ts`: `club numbers in the org console equal the club dashboard`; `money appears only
  after the club opts in per metric`.
- `federation-registry.e2e-spec.ts`: `belt shows as confirmed by the club only after the member consents`;
  `withdrawn consent removes the person; a child appears only with a guardian's consent`.
- `federation-events.e2e-spec.ts`: `member registers through their own club, coach registers a consenting
  student, capacity is enforced`. `federation-template.e2e-spec.ts`: `club adopts a ladder template as an
  editable copy`.

Admin: `features/org/*` view helpers («не открыт», plurals, registry row), `OrgGate`, `ClubFederationSettings.spec.tsx`
(owner vs admin, leave confirm with `<ConfirmDialogHost />`), picker redirect; admin e2e org matrix crawl (7 routes
populated, no `NaN`/`undefined`) + `settings/federation`. Mobile: `notification-route.spec.ts`, consent and
event-section helpers (full / closed / consent states).

## 9. Acceptance checklist

- [ ] `federation@academy.demo` signs in and lands on `/org/<id>` «Клубы». ACADEMY's numbers match the ACADEMY
      dashboard. Money shows «не открыт» for ACADEMY and a figure for Беркут, with the total «по 1 из 2 клубов».
- [ ] «Реестр поясов» finds a demo student by surname with «подтверждён клубом ACADEMY» and a date only.
      `student@academy.demo` turns the consent off in the app and disappears on reload.
- [ ] Inviting Ритм by `RTMDANCE` shows the club name; a non-owner club admin can't accept (e2e); `owner@ritm.demo`
      accepts in «Настройки → Федерация» and the club appears in the list. Leaving removes it.
- [ ] The tournament shows in the ACADEMY app's «События»; `student@academy.demo` registers, the org sees him under
      ACADEMY, and capacity is enforced.
- [ ] An org announcement to staff reaches `owner@academy.demo` (not at night); a members one appears in both
      clubs' feeds marked «Федерация …», and not in a club that switched it off.
- [ ] Беркут's ladders show «Стандарт федерации», and «Взять за основу» creates an editable copy.
- [ ] Org staff get 403/404 on every `workspaces/:id/*` route of member clubs (e2e).
- [ ] Club sidebar unchanged (11 items); a club with no links has no «Федерация» settings entry.
- [ ] tsc (server, admin, mobile), unit tests, server e2e `organizations/*`, contract drift, admin e2e green.

## 10. Decisions

- **`Organization` over clubs, each club its own tenant.** No shared roster or money. The org reads aggregates
  and consented registry rows through allow-listed domain readers, never through club routes.
- **Owner-only acceptance; leave by any club admin, any time.** Joining shares data of the legal entity (owner's
  call); leaving only reduces sharing, so the lower bar is safe. A club may join several orgs.
- **Invite by the club's join code** (the existing public lookup). No club search directory: clubs dislike
  marketplaces (`concept.md:43-44`).
- **Org roles:** `ORG_ADMIN` (everything) and `ORG_COACH` (clubs and metrics read, registry, calendar, templates;
  no clubs or team management, announcements read-only). Super admin = org admin.
- **Console at `/org/<id>`**, a third top-level area with 7 items, not a tab of a club and not `/platform`. Org
  creation is a platform action.
- **Metrics = glossary functions**, identical to the club's screens. Two glossary rows are added to
  `2026-11-08-admin-cleanup.md` B2: `new_students_30d` («Новые ученики за 30 дней», `countNewStudents`, since =
  now − 30 d) and `newcomer_retention_3m` («Удержание новичков за 3 месяца», `averageRetention` offset 3 over
  `loadCohortReport`, whole club). Money is off by default, with a club opt-in per metric (`mrr`, `revenue_30d`).
- **Registry: name + belt + club + date**, latest per ladder, history on tap. Basis = a per-org person consent
  `ORGANIZATION_SHARING` (guardian for a child), revocable, evidence in `ConsentRecord`. The club's
  `shareRegistry` is a second gate. Live computation, so withdrawal or leaving takes effect at once.
- **Ladder template = copy with provenance** (`templateId`, `templateVersion`, `templateLevelId`), no live link.
  It enables «filter by standard level» across clubs.
- **Org events are their own small model** with free registration, capacity and no waitlist; `feeNote` is text.
  Reusing `WorkspaceEvent` would push foreign members into a club's roster and tickets into its revenue glossary.
  Paid org events are §12.
- **Org announcements:** staff push (quiet hours respected per club); members only through the feed, with a club
  switch. No member push in the MVP, so a federation can't bypass a club's mute.
- **Audit** gains `organizationId`; club-side decisions appear in the club's history too.
- **Free in the MVP**, behind env `ORGANIZATIONS_ENABLED` (default off in production, on for demo/pilots) until the
  lawyer answers §13; org routes return 404 when off. Billing per club licence later (`master-prompt.md:91-92`).
- **Demo:** a new generated BJJ club «Беркут» (no real names), the org with ACADEMY + Беркут, `federation@academy.demo`.
- **(implementation) Demo federation account** `federation@academy.demo` is `DEMO_FEDERATION_ACCOUNT`, listed with
  ACADEMY's accounts in `demo-clubs.ts` (fixed-code sign-in, console card) but not in `DEMO_ACCOUNTS`: the ACADEMY
  generator doesn't write it, the federation seed does. `isDemoOnlyAccount` also refuses staff of a non-demo org.
- **(implementation) Federation seed runs after every demo reset** (any club) and at boot when the org is missing or a
  club was created; it replaces every scripted org row (links, staff, templates, events with registrations,
  announcements, `ORGANIZATION_SHARING` consents, `org.*` audit rows) and drops the `org-metrics:<orgId>` cache.
  Seeded announcements carry `staffNotifiedAt` (no push on reset); the meeting date is relative (today + 9 days).
  Seeded regardless of `ORGANIZATIONS_ENABLED` (routes stay 404 while off).
- **(implementation) Consents are drawn from the person's id** (stable across resets): 85% of adult students, 60% of
  children — a child only through a guardian with a confirmed link, so ACADEMY (6 confirmed links) contributes few
  children. The registry lists only ladders linked to a standard: ACADEMY's «Пояса БЖЖ» (adults, v1) and «Пояса БЖЖ
  — дети» (kids, v1, linked level by level), «Беркут»'s two copies — ~180 rows, not ~300. Script: `student@`
  consented; `parent@` undecided (Home card), Миша allowed, Аня not.
- **(implementation) Mobile:** staff sign students up for a members' event («Записать учеников») and sign themselves up
  only for a coaches' event; the Home card shows to students and parents only; one cache key (`my-orgs:<ws>`) feeds the
  card, the settings switch, «События» and «Мой ранг».
- **(implementation) Admin console details.** One side panel per screen face: the calendar's panel shows the event
  with registrations and turns into the editor on «Изменить» (a panel never opens a panel). The club picker lists
  clubs and federations as tappable rows (no «Открыть клуб» button per row). An org coach sees «Клубы» and
  «Объявления» read-only (no «Пригласить клуб», no «⋯», rows don't open the editor); «Команда» and «Настройки» show
  «Раздел доступен администраторам федерации». A pending invitation's «⋯» says «Отозвать приглашение».
- **(implementation) Federation items in the club's «Объявления»** come from the club feed (`GET …/announcements/feed`;
  for club staff it carries STAFF and STAFF_AND_MEMBERS org items), merged by date among the club's unpinned items,
  hidden while a direction filter is on (they belong to no direction).
- **(implementation) Outdated copy note** on «Пояса → Лестницы» reads the `templates` of the ladder list (the source
  standards as they are now), so it still shows after the club left the federation; the «Стандарты федерации»
  block lists only standards of active federations and sits below the club's own ladders.
- **(implementation) Org journal** reuses the club journal list (`features/audit/AuditFeed.tsx`), «Настройки →
  История изменений» tab via `?tab=history`; no area filter (the org journal has few action families).
- **(implementation) Registry population.** A row needs a live `ORGANIZATION_SHARING` record for that org — the
  person's own, or a guardian's with `dependentId` while that guardianship is confirmed (`consentAt`) — and the
  person must still be an ACTIVE member of the awarding club (a member who left the club drops out). Withdrawal
  stamps every live record of the person for that org (own and guardians'). `personKey` = `p_` + 20 hex of
  HMAC(`ENCRYPTION_SECRET`, org + user); the history read resolves it among the consenting people only, so a
  key of a withdrawn person answers 404. Registry query params use `clubId`, never `workspaceId`.
- **(implementation) Registry = the federation's standards only** (owner-proxy decision). A rank reaches the
  registry (list, filters, history panel, event-registration belt) only from a club ladder copied from one of
  *this* org's templates (`RankLadder.templateId` ∈ the org's templates); a club's other ladders (another
  discipline, its own scheme — «Уровни ММА» next to «Пояса БЖЖ») never do. Deleting a template takes its copies'
  ranks out of the registry. A club that hasn't adopted a standard shows no belts until it links one.
- **(implementation) Consent text per signer.** `consentText` is first person for the member and, for a guardian
  acting for a child, names the child («имя и фамилию моего ребёнка, его пояс…»), matching the `dependentId`
  record it produces; `ORG_SHARING_CONSENT_VERSION` = `2026-11-26.2`.
- **(implementation) Org event registrations list** names only people whose consent for the org is live and
  whose club is still ACTIVE in it; the other bookings keep their place and show as `hiddenCount`. `bookedBy` is
  SELF when the person or their guardian booked, COACH otherwise. Error codes: 409 `ORG_CONSENT_REQUIRED`, 409
  `ORG_EVENT_FULL` («Мест нет»). A coaches-only event (audience STAFF) is visible and bookable only by the club's
  staff themselves, not for students, and is not gated by `allowMemberEvents`.
- **(implementation) Extra route** `GET workspaces/:id/org-events/:eventId/students` (`listOrgEventStudents`,
  `COACHING_ROLES`) feeds «Записать учеников»: own-group active students (admin scope: every group), with consent and
  booking state.
- **(implementation) Event reminder** `org_event.reminder` («Скоро событие федерации»): once per booking, at the first
  minute outside the registering club's quiet hours within 24 h before the start (minute job). The staff push of an
  org announcement is claimed per club (`org.announcement` / `<id>:<workspaceId>`), one row per person, and skipped
  for announcements published more than 2 days ago. `org_event.registered_by_club` is mute-exempt (something booked
  for the person); the reminder and `org.announcement` stay mutable.
- **(implementation) Template versions** bump on every level create/update/delete; name, audience and archiving
  don't. Deleting a template or a level leaves club copies intact (plain ids). The ladder list returns
  `templateId`/`templateVersion` per ladder plus `templates` (current name, org, version).
- **(implementation) Org staff get 403 on writes beyond their tier** (an org coach posting an announcement) and 404
  as strangers to the org; event and template writes are open to every org staff member as §3.2 says.
- **(implementation) Flag = guard.** `ORGANIZATIONS_ENABLED` (default off, `.env.example`) is enforced by
  `OrganizationsEnabledGuard`, the first guard of every controller under `features/organizations/**` and
  `features/club-organizations/**` (pinned in `route-tier-consistency.spec.ts`), plus `assertOrganizationsEnabled()` in
  the platform org handlers and the from-template handler. The server e2e env turns it on (its routes are in the
  tenant sweep).
- **(implementation) Invite preview** uses the existing `GET public/clubs/by-code/:code`; no new preview route.
  A re-invite of a `DECLINED`/`LEFT`/`REMOVED` link resets the sharing toggles to the defaults (money off) — joining
  again is a new decision. Revoking a pending invite and excluding an active club both set `REMOVED`.
- **(implementation) Clubs list** shows `ACTIVE` and `INVITED` links only (declined/departed are history). The metrics
  cache (`org-metrics:<orgId>`, 10 min) holds per-club numbers; accept, leave, remove and sharing changes drop it, so
  money and membership changes show on the next read. `new30d` is `countNewStudents` since now − 30 d; totals sum the
  most common currency only (no conversion) and report `clubs` for «по N из M клубов».
- **(implementation) Team:** `POST orgs/:id/members` also changes the role of an existing teammate (no separate PATCH);
  demoting or removing the last `ORG_ADMIN` → 400. The new member gets the «Вас добавили в команду федерации» e-mail.
- **(implementation) Org logo** follows the club logo rules: `POST orgs/:id/logo-upload` (`createOrganizationLogoUpload`,
  key under `organizations/<id>/logo/`), signed short-lived URLs.
- **(implementation) Org journal privacy:** a club-side decision (`org.acceptInvite` …) appears in the org's
  «История изменений» as «Клуб «X»» — actor id, name and e-mail of the club person are stripped. Audit action names
  follow the `<entity>.<camelCaseVerb>` rule: `org.memberAdd`, `org.announcementCreate`, … and `ladder.fromTemplate`
  (the design's `rankLadder.fromTemplate` breaks the lowercase-entity rule).
- **(implementation) Picker routing** needs no change to `get-my-workspaces`/`me`: the admin reads `GET orgs/mine`
  (own memberships of active orgs; the platform admin lists orgs in the console instead).
- **(implementation) Mute:** the prefix `org.club_` (invited / joined / left) is mute-exempt.
- **(implementation) Home card shows the consent text first.** «Разрешить» on «Клуб вступил в федерацию» opens the
  same sheet as «События» (the server's `consentText`, button «Разрешить»), so nobody grants a recorded consent
  edition from a one-line summary. The club-settings switch grants directly, with the text printed under it.
- **(implementation) Coach picker search.** A club's coach can have a few hundred students (ACADEMY's head coach
  ~310), so «Записать учеников» gets a name search past 12 students (case- and «ё»-insensitive, every word).
- **(implementation) Declining is any club admin's call.** The invitation card offers «Отклонить» to every club admin
  (the decline route is `CLUB_ADMINS`, like leaving: declining shares nothing); only «Принять» is the owner's, and a
  non-owner admin sees «Принять может только владелец клуба» beside «Отклонить».
- **(implementation) «Новые за 30 дней» has no club screen to match.** The glossary row lives only in the console;
  the acceptance proof checks it against the club's own roster (students whose membership started in the trailing
  30 days, `GET …/members?sort=newest`). Students, active and attended-30d match «Прогноз выручки», «Тариф» and
  «Сегодня → Посещаемость».

## 11. Implementation slices

Server first: S1 lands the schema, DTOs, controllers and the regenerated contract, then S2 and S3 run in parallel
against the types. Nobody runs the full gate mid-flight.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server | `apps/server/prisma/schema.prisma`; `apps/server/src/environments/environment.ts` (+spec; `ORGANIZATIONS_ENABLED`); `apps/server/src/domains/organizations/**` (+specs); `domains/notifications/quiet-hours.ts` (+spec; first of the two designs to land creates it); `features/organizations/**`; `features/club-organizations/**`; `features/platform/{platform.controller.ts, create-organization.*, list-organizations.*}`; `shared/guards/organization-member.guard.ts`, `shared/decorators/org-roles.decorator.ts`; `shared/access/route-tier-consistency.spec.ts`; `features/manage-announcements/{get-feed.handler.ts,schemas.ts}` (+spec); `features/manage-ranks/**` (from-template route); `domains/scheduler/reminders.service.ts` (+spec); `domains/notifications/notification-mute.ts` (+spec); `domains/audit/services/audit.service.ts`; `features/mcp/tools/club-tools.ts` (+spec); `app/app.module.ts`; `apps/server-e2e/src/organizations/**`; `open-api.json`, `libs/api-client/src/openapi/*` | 6 d |
| S2 admin | `apps/admin/src/app/(dashboard)/org/**` (layout, sidebar, 7 pages); `apps/admin/src/features/org/**` (sheets, tables, view helpers, specs); `shared/api/organizations.ts`, `shared/api/platform.ts` (orgs); `app/(dashboard)/workspaces/page.tsx`; `…/workspace/[workspaceId]/settings/federation/page.tsx` (new), `features/settings/SettingsNav.tsx`, `features/settings/ClubFederationSettings.tsx` (new); `…/ranks/page.tsx` (templates block); `features/announcements/*` (source line); `…/workspace-sidebar.tsx` (account menu label); `app/(dashboard)/platform/page.tsx` + `features/platform/PlatformOrganizations.tsx` (new); `features/audit/audit-meta.ts`; `shared/lib/contract-limits.ts` (+spec); `apps/admin-e2e/src/role-matrix.ts` | 4.5 d |
| S3 mobile + demo + docs | `apps/mobile/src/features/clubs/ClubSettingsScreen.tsx`; `features/home/*` (consent card); `features/schedule/EventsScreen.tsx` + `features/org-events/**` (new helpers, picker); `features/ranks/MyRanksScreen.tsx`; `features/announcements/AnnouncementsScreen.tsx`; `features/notifications/notification-route.ts` (+spec); `shared/api/organizations.ts`; `apps/server/src/domains/demo/{berkut-demo.accounts,berkut-demo.plan,demo-organization,demo-clubs,demo-accounts,demo-access,demo-club.service}.ts` (+specs); `docs/demo.md`, `docs/strategy/concept.md` §2.10 status, `docs/legal/README.md` (lawyer questions), the glossary rows in `docs/design/2026-11-08-admin-cleanup.md`, `CHANGELOG.md` | 4 d |

Interface: §2 models, §3.2/§3.3 routes and names, error code `ORG_CONSENT_REQUIRED`, the notification kinds of
§3.4, the realtime key `organizations`, consent kind `ORGANIZATION_SHARING`.

Integrator checks: tsc server / admin / mobile; `npx nx test @clubspace/server -- organizations` (+
`club-organizations`, `registry`, `get-feed`, `reminders`, `notification-mute`, `route-tier-consistency`,
`manage-ranks`, `demo`); server e2e `organizations/*`; contract drift; admin e2e; `cs-reviewer` before merge.

## 12. Out of the MVP — next steps with sketches

1. **Tournaments (L):** `Tournament` on `OrganizationEvent(kind=COMPETITION)`; `Division` (age band, weight, level
   — config per org, not enums); `Entry` from registrations with declared weight; tablet weigh-in moving athletes
   between divisions; single-elimination brackets seeded to separate clubs; `Match` (method, points); a judge
   role per event and a mat-side scoring PWA with an offline queue; results feed the registry («призёр»).
2. **Membership fees (L):** an org ЮKassa shop (encrypted keys, the club pattern), `OrganizationFee` per season per
   athlete or club, 54-ФЗ receipts with the federation as seller, an org journal; paid org events reuse the
   checkout. Needs the federation's legal entity and an org offer/DPA edition.
3. **Medical documents (M–L):** health data is a special category (152-ФЗ ст. 10) — written consent, restricted
   access, retention, RF storage; `MedicalClearance { userId, validUntil, fileKey, verifiedBy }` seen by the club
   doctor/admin, the org sees only «допуск до …». Lawyer first.
4. **Sports-committee paperwork (M):** entry lists (заявочный лист) from registrations, rank submissions (разряды)
   per the Минспорт order with attendance/results evidence, ЕКП export; PDF/XLSX templates per region.
5. **Global athlete profile, transferable belts:** a shareable «подтверждён клубом X» page; a new club «признаёт»
   a belt. Builds on the registry consent.
6. **Org billing** (licence per club), **live template sync** (opt-in diff), **org MCP** (read tools), **org
   trends** (nightly snapshot).

## 13. Open risks

- **Legal basis is our reading, not a lawyer's.** Consent per org for the registry and events, and no person
  data in metrics (aggregates only). `docs/legal/README.md` gets questions: is a consent screen in the app
  sufficient for transfer to a federation (a third-party operator)? Is the club's own consent needed in the DPA?
  Is a new privacy-policy section needed? Until answered, the feature ships to the demo and pilot clubs only
  (platform flag `ORGANIZATIONS_ENABLED`, default off in production).
- **Small-club re-identification.** Aggregates for a 12-student club reveal little but not nothing. Accepted:
  only counts, no lists.
- **Metric cost.** The cohort report per club per load is the heaviest read. The 10-minute cache bounds it
  [INFERENCE: fine below 50 clubs; above that, add the nightly snapshot of §12.6].
- **Registry completeness.** It shows only consenting people, so early on it looks thin. The demo seeds 85%. A
  real federation will see adoption grow with the in-app card.
- **Ladders differ across clubs.** Without adopting the template, cross-club «level» filters can't match. The
  registry still shows each club's own level name.
- **Org staff who are also club staff** see more in their own club, through the club, as today. The console
  never mixes the two.
