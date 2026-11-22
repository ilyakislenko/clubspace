# Requests inbox «Заявки» (backlog E6)

Status: **design** · 2026-11-15 · base: `feat/admin-cleanup` @ `a90880ad`
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E6 (owner: «стартуй разработку», order
E1 → E6 → E3 → E2). Evidence: [UX audit](2026-11-08-admin-audit-ux.md) §5 row «Входящие заявки одним
списком» (`2026-11-08-admin-audit-ux.md:197`). Sibling: [payments journal](2026-11-15-payments-journal.md).
File:line references are as of `a90880ad`. The owner was asleep while this was written. Every choice the
owner would normally make is listed in §10 «Decisions» and may be overruled.

## Кратко (для владельца)

Ученики просят клуб о четырёх вещах: принять в клуб, заморозить абонемент, провести персональную
тренировку и разобрать видео. Сейчас это четыре разных места. Заявки на вступление лежат над списком
учеников. Заморозку можно решить только в карточке ученика. Персональные тренировки и разборы видео в
админке не видны совсем, они есть только в приложении у тренера. Если тренер не отвечает, никто этого не
замечает, и заявка тихо сгорает.

Что сделаем:
1. **Вкладка «Заявки» в разделе «Ученики».** В меню по-прежнему 11 пунктов. Это один список всего, что
   ждёт ответа клуба, старые заявки сверху. У каждой строки есть вид заявки, имя, суть просьбы и срок
   ожидания. Вступление можно принять или отклонить прямо в строке. Остальные заявки открываются
   боковой панелью:
   - заморозка: одобрить с той же формой дат, что в карточке, или отклонить с комментарием;
   - персональная тренировка: подтвердить одно из времён ученика, предложить своё или отклонить;
   - разбор видео: посмотреть ролик, оставить комментарии к моментам, отметить «отвечено» или закрыть.
2. **На «Сегодня» вместо двух строк будет одна, «Заявки · N»,** с разбивкой по видам. Ссылка ведёт в
   этот список. Число на «Сегодня», число на вкладке и сам список берутся из одного запроса к серверу,
   поэтому всегда совпадают.
3. **Каждый видит только то, что может решить сам:**
   - владелец и администраторы видят всё;
   - главный тренер видит всё, кроме заявок от будущих сотрудников (их принимает только администратор);
   - тренер видит заморозки и разборы видео учеников своих групп и персональные тренировки, которые
     просят именно у него.

   Денег в заявках нет, скрывать нечего.
4. **Ученик узнаёт о любом решении.** Уведомления об одобрении, отказе и новом времени уже есть.
   Добавим одно, которого не хватало: «заявка в клуб отклонена». В нём будет комментарий, если его
   написали.

Приложение не меняется: тренеры по-прежнему отвечают там. Список в админке обновляется сам, когда
заявку решили в приложении.

## Problem

1. **Four kinds of member requests, four places, two of them invisible in the admin.**
   - **Join requests** (`WorkspaceMember.status = INVITED`, `schema.prisma:47-52,1135`) are a block above
     the roster (`app/…/users/page.tsx:362-405`). The block reads `GET …/pending-users`
     (`list-pending-users.controller.ts:19-21`).
   - **Freeze requests** (`SubscriptionFreezeRequest`, `schema.prisma:2867-2911`) are decided only inside
     the member card (`features/subscriptions/SubscriptionFreezeBlock.tsx:175-273`, mounted from
     `MemberSubscriptionPanel.tsx:331`). «Сегодня» can only link to the card: one row per member, hint
     «решаются в карточке ученика» (`features/dashboard/DecisionList.tsx:82-128`). Past 100 requests it
     says «И ещё N — в карточках учеников» (`:121-124`).
   - **Personal-training requests** (`PersonalTrainingRequest`, `schema.prisma:2344-2414`) have no
     admin UI at all. The server already has a club-wide read, `GET …/personal-trainings?view=workspace`
     (`list-personal-trainings.handler.ts:38-50`), but no client calls it. The mobile wrapper sends no
     `view` (`apps/mobile/src/shared/api/personal-trainings.ts:40-47`). A request reaches only the
     chosen coach (`request-personal-training.handler.ts`, notice `personal.requested` to `[coachId]`).
     When that coach doesn't answer, it turns `EXPIRED` once the member's times pass
     (`personal-training-utils.ts:62-96`), and nobody else ever sees it.
   - **Video-review requests** (`VideoReviewRequest`, `schema.prisma:1499-1519`) exist only in the mobile
     app: `ClubVideoReviewsScreen.tsx`, «Ждут ответа», and the staff list `video-reviews.controller.ts:90-91`.
     The admin web has no reference to them.
2. **«Сегодня» counts come from separate reads with different shapes and rules written into the page**
   (`app/…/workspace/[workspaceId]/page.tsx:88-104`):
   - the join count downloads the whole uncapped applicant list just to read `total` (`:92`;
     `list-pending-users.handler.ts:23-38` has no `take`);
   - the freeze count reads a list capped at 100 with an uncapped `total`
     (`list-pending-freeze-requests.handler.ts:13,63-77`);
   - personal trainings and video reviews are not counted anywhere;
   - who sees which row is decided in the page (`:91-97`), not by the server.
3. **Scope and rule gaps around join requests.**
   - Approving a pending row that holds a staff role needs a club admin
     (`add-workspace-member.handler.ts:126-135`, `assertCanManageRoles`). Rejecting the same row needs
     only a sport lead (`reject-pending-member.handler.ts:36-50`).
   - «заявка от …» shows the *account's* creation date, not the request's: `createdAt: p.user.createdAt`
     (`list-pending-users.handler.ts:46`), rendered at `users/page.tsx:381`. A person who had an account
     for a year and applies today reads as «заявка от» last year.
4. **A rejected applicant hears nothing.** Reject writes `BLOCKED`, an audit entry and a realtime
   signal, and stops there (`reject-pending-member.handler.ts:47-64`). An approval sends an inbox entry
   and an e-mail (`domains/workspace/services/join-request.service.ts:174-230`).
5. **An admin screen can't stay live for two of the four kinds.** Personal-training writers signal only
   the member's and coach's own rooms (`invalidateUsers`, e.g. `request-personal-training.handler.ts:126`,
   `accept-personal-training.handler.ts:139`). Video-review writers emit nothing (no `realtime` call in
   `features/video-reviews/`).

## What counts as a request

A *request* is something a member (or an applicant, or a guardian acting for a child) asked the club
for, which then sits waiting on a staff decision. Every model with a pending-like state was checked:

| Candidate | In? | Why (evidence) |
|---|---|---|
| Join request, `WorkspaceMember` `INVITED` | ✅ | member-initiated (`POST workspaces/join`, `join-workspace.controller.ts:29-52`); staff decide (`add-workspace-member.controller.ts:37`, `reject-pending-member.controller.ts:32`) |
| Freeze request, `SubscriptionFreezeRequest` `PENDING` | ✅ | member-initiated (`my-freeze-requests.controller.ts:40-57`); staff decide (`freeze-requests.controller.ts:82-107`) |
| Personal training, `PENDING_COACH` and not expired | ✅ | member-initiated (`personal-trainings.controller.ts:190`); coach or admin decides (`:209,232,256`). `PENDING_MEMBER` waits on the member, not the club: out |
| Video review, `status = 'open'`, clip uploaded and not failed | ✅ | member-initiated (`my-video-reviews.controller.ts:71,85`); staff answer (`video-reviews.controller.ts:136,158`) |
| Event registration `WAITLISTED` | ❌ | promoted automatically, no approval step (`schema.prisma:1012-1016`) |
| Class booking `WAITLISTED` | ❌ | promoted automatically (`schema.prisma:864-870`) |
| Drop-in booking | ❌ | an RSVP with nothing to decide (`schema.prisma:2313-2319`) |
| Grading candidate `PENDING` | ❌ | staff add candidates (`rank-gradings.controller.ts:234-235`, `COACHING_ROLES`); members can't apply. The result is staff-set |
| Class substitution `OFFER` `PENDING` | ❌ | staff → staff, decided in the calendar panel (`features/schedule/ClassSubstitutionPanel.tsx`) |
| Workspace invitation | ❌ | club → person; the invitee decides |
| `OnboardingHelpRequest`, `DemoRequest` | ❌ | club → ClubSpace platform |

## Goal / non-goals

**Goal.** A staff member answers «что ждёт моего решения» in one list. They decide each item there
with the existing rules and endpoints, and the member hears the outcome. The «Сегодня» count, the tab
count and the list are one server read, scoped to what this viewer may decide.

**Non-goals.**
- New request kinds or a generic request table. Each kind keeps its own model and lifecycle.
- Leads and trial pipeline (backlog E5). A join request stays a join request.
- Changing who may decide what. The inbox applies today's rules. The one tightening is the
  staff-row reject in §3.4, which makes reject match approve.
- Mobile changes beyond routing the one new notification kind (§5). Coaches keep answering in the app.
- Drawing on video frames or editing comments in the admin. These stay in the app (§4.4).
- Narrowing `GET pending-users` from `STAFF_ROLES`. Mobile «Пригласить» deliberately lists applicants
  to every coach and lets only sport leads decide (`ClubInviteScreen.tsx:73-90`, `canSeeClubInvite` /
  `canDecideRequests`).
- Reminders or escalation for unanswered requests. The inbox and «Сегодня» make them visible; a nudge
  job has no requester.

## Ground rules

As in the [parent spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer):
- `CLAUDE.md` + `docs/conventions.md` are authoritative.
- Use `prisma db push` only, never `--accept-data-loss`.
- Authorize in the handler.
- Return `serialize*` DTOs. Controller-method and DTO names are unique.
- Regenerate the contract after DTO changes.
- Follow the UI rules: `confirmDialog`, `useDirtyGuard`/`confirmLeave`, one filled button, no chips.
- Sport-agnostic: no kind or copy assumes a discipline. Coach and personal-session words come from the
  club vocabulary (`useVocabulary`).

## 1. The request rule

One definition per kind: what makes the item **open**, and who **may decide** it. The inbox lists
exactly the open items the viewer may decide. Nothing in it is read-only. A row you can't act on
would be noise, and the 403 would surface only after a click.

Scope terms:
- **club-wide** = `rbac.canWriteAllGroups(ctx)`: owner, admin, head coach, super admin
  (`rbac.service.ts:53-108`);
- **club admin** = `isClubAdmin` (`shared/access/assert-admin-scope.ts`);
- **own groups** = `ownGroupsWhere(userId)`: groups the user coaches or whose direction they run
  (`rbac.service.ts:35-41`).

| Kind | Open when | Who decides (= who sees it) | Decisions (existing endpoints) |
|---|---|---|---|
| `join` | `WorkspaceMember.status = 'INVITED'` | Club-wide viewers. A pending row holding a staff role (coach, head coach, admin) is shown to club admins only, the rule of `assertCanManageRoles` | Accept `POST members {userId}` (`addMember`) · reject `POST members/:userId/reject` (`rejectPendingMember`) |
| `freeze` | `PENDING`, still a current abonement of an `ACTIVE` member. This is today's where (`list-pending-freeze-requests.handler.ts:36-62`). Club section «Абонемент» on | Club-wide viewers see all. Others see members of own groups and never their own request (`freeze-request-access.ts:46-53`) | Approve `POST freeze-requests/:id/approve {fromDate?, days?, reason?}` · decline `…/decline {comment?}` |
| `personal` | `PENDING_COACH` with at least one member option still in the future. This is the SQL twin of `displayStatus` ≠ `EXPIRED` (`personal-training-utils.ts:79-88`) | The chosen coach (`coachId = me`). Club-wide viewers see all, since they act for the coach (`personal-training-access.ts:88-111`). Never a request the viewer filed as the member | Accept `POST personal-trainings/:id/accept {optionId}` · propose `…/propose {startAt, durationMin, comment?}` · decline `…/decline {comment?}` |
| `video` | `status = 'open'` and clip status `uploaded`, `processing` or `ready`, i.e. `displayStatus` ∈ {`processing`, `open`} (`video-reviews-utils.ts:23-31`). Club section «Видео» on | Club-wide viewers see all. Others see members of own groups plus members no group coach looks after (`list-club-video-reviews.handler.ts:44-51`). Never their own clip | Comment `POST video-reviews/:id/comments {atSec, text}` · delete own comment `DELETE …/comments/:commentId` · status `PUT video-reviews/:id/status {status: answered\|closed}` |

**Waiting since** = the item's `createdAt` for every kind:
- join: the membership row's `createdAt`, which is the moment of the request (`join-request.service.ts`
  `requestMembership` creates it);
- freeze, personal, video: their own `createdAt`.

Order = waited longest first (`createdAt asc, id asc`), as the freeze and video staff lists already do.

**Money:** none of the four kinds carries an amount. A personal session's price is off-app
(`schema.prisma:2365`), and a freeze row names the tariff but not its price. So the DTO has nothing to
strip. A future kind that carries money must strip it with `isClubAdmin` (conventions §1 tier rule).

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
model PersonalTrainingRequest {
  // …existing fields…
  @@index([workspaceId, status, createdAt]) // requests inbox: open requests, oldest first
}
```

That is the only schema change:
- `SubscriptionFreezeRequest` and `VideoReviewRequest` already have `@@index([workspaceId, status, createdAt])`
  (`schema.prisma:2908,1517`).
- `WorkspaceMember` reads go through `@@index([workspaceId, status, …])` (`:1179-1180`). Pending rows are
  few, so the `createdAt` sort happens in memory.
- No new table. A join-decline comment travels in the notification and the audit metadata, and a
  `BLOCKED` row needs no column for it.
- No backfill.

## 3. Server

### 3.1 Domain — `apps/server/src/domains/requests/open-requests.ts`

Pure where-builders plus loaders, unit-tested. This module is the single definition of §1. Every
reader imports it.

```ts
type RequestKind = 'join' | 'freeze' | 'personal' | 'video'
type RequestViewer = {
  workspaceId: string
  userId: string
  clubWide: boolean          // rbac.canWriteAllGroups(ctx)
  clubAdmin: boolean         // isClubAdmin
  ownGroupMemberIds: () => Promise<string[]>  // rbac.ownGroupMemberIds(ctx), lazy
  sections: { subscription: boolean; videos: boolean }
}
pendingJoinWhere(viewer)            // null when !clubWide
pendingFreezeWhere(viewer, now)     // null when !sections.subscription
openPersonalTrainingWhere(viewer, now)
openVideoReviewWhere(viewer)        // async (member ids), null when !sections.videos
countOpenRequests(prisma, viewer, now) → { join, freeze, personal, video, total }
loadOpenRequests(prisma, viewer, now, { kind?, curPage, perPage }) → { rows, total }
```

- `pendingFreezeWhere` is the body of `list-pending-freeze-requests.handler.ts:36-62`, moved here.
  That handler now imports it, so the mobile staff card and the inbox can't diverge.
- `pendingJoinWhere` = `{ workspaceId, status: 'INVITED' }` plus, below club admin,
  `role: { name: { notIn: STAFF_ROLES } }`. `list-pending-users.handler.ts` imports the base part only:
  its staff-wide read stays as it is (non-goal).
- `openVideoReviewWhere` reuses the member scope of `list-club-video-reviews.handler.ts:44-51`,
  extracted into `review-clip-access.ts` as `reviewStaffMemberWhere(rbac, ctx, workspaceId)`. Both use it.
- Merge and pagination follow the journal pattern:
  - each applicable source does `findMany` ordered `(createdAt asc, id asc)` with
    `take = curPage × perPage`, then the results are merged and the page sliced;
  - `total` = Σ source counts;
  - `curPage × perPage > 1000` → 400 «Слишком далеко — выберите вид заявки». Pending queues are small;
    this is only a guard.
- `counts` always cover every kind in the viewer's scope, regardless of the `kind` filter.
  A kind that doesn't apply (section off, not club-wide for `join`) counts 0.

### 3.2 Endpoint — `features/requests/`

| Endpoint | Method name | Tier (`@Roles` + handler) | DTOs |
|---|---|---|---|
| `GET workspaces/:workspaceId/requests` | `listOpenRequests` | `STAFF_ROLES` + `rbac.resolveCoachScope` (throws below staff; owner bypass inside) | in `ListOpenRequestsQuery`, out `ListOpenRequestsOutput` |

It is a coach-scope read, so `STAFF_ROLES` (conventions §1). It is not on the `CLUB_ADMINS` list of
`route-tier-consistency.spec.ts`. There is no `FeatureEnabledGuard`: the sections are applied per kind
inside, and the read is fired on every «Сегодня» load (conventions: never gate a read like that).

`ListOpenRequestsQuery`:
- `kind?`: `join | freeze | personal | video`;
- `curPage` (default 1);
- `perPage` (default 50, min 1, max 100). «Сегодня» and the tab badge call with `perPage=1` and read
  `counts`, the at-risk pattern (`page.tsx:111`).

`ListOpenRequestsOutput`:
- `data: OpenRequest[]`, `total`, `curPage`, `perPage`;
- `counts: { join, freeze, personal, video, total }`;
- `kinds: RequestKind[]`: the kinds that apply to this viewer in this club. The filter shows only these;
  with one kind there is no filter.

`OpenRequest` is flat with a `kind` enum and one nullable detail object per kind: no union, no `oneOf`
(conventions §1).

| Field | Content |
|---|---|
| `id` | `join:<membershipId>` / `freeze:<uuid>` / `personal:<uuid>` / `video:<uuid>`. Also the deep-link key `?request=` |
| `kind`, `requestId` | enum · the uuid the decision endpoint takes (for `join`: the applicant's `userId`) |
| `createdAt` | waiting since (§1) |
| `member` | `{ userId, name, email \| null, isDependent, guardians }`. `isDependent = email === null` and `guardians` via `serializeMemberGuardians` (`features/dependents/schemas`), the roster's rule (`list-workspace-members.handler.ts:214-215`) |
| `join` | `{ roleName }` (`user` for students; staff role names reach club admins only) \| null |
| `freeze` | `{ fromDate, untilDate, days, reason, planName, subscriptionId, subscriptionEndDate }` \| null. `subscriptionEndDate` feeds `FreezeForm`'s bound |
| `personal` | `{ coach: { userId, name }, gymName \| null, timezone, memberComment \| null, options: [{ id, startAt, durationMin }] }` \| null. `options` = the member's future options, oldest first |
| `video` | `{ title, message \| null, clipStatus: 'processing' \| 'ready', durationSec \| null, commentCount }` \| null |

Serializers live in `features/requests/schemas.ts` (`serializeOpenRequest`). Dates use `.toISOString()`
and `z.iso.date()` for the freeze day fields, as `serializeFreezeRequest` does.

### 3.3 Decisions go through the existing endpoints

The inbox adds no decide endpoint. Every action calls the route that mobile and the member card already
call, with their authorization and their race guards. A double click or a second staff member is
handled where it is today:
- freeze: `updateMany … status: 'PENDING'` → 409 `RACE_MESSAGE` «Заявку только что рассмотрели —
  обновите экран» (`freeze-request-access.ts:62`);
- personal: `updateMany` on `status` + `updatedAt` → 409 «Статус заявки изменился — обновите экран»
  (`accept-personal-training.handler.ts`);
- join reject: `updateMany … 'INVITED'` → 404 «Заявка не найдена» (`reject-pending-member.handler.ts:47-54`);
- join accept on an already active row: 400 «Пользователь уже участник этого клуба»
  (`add-workspace-member.handler.ts:121-125`).

None of these is an edit form, so `expectedUpdatedAt` doesn't apply: each decision is a compare-and-set
on the status.

### 3.4 Changes to existing writers

- **Realtime key `requests`.** Every write that opens or closes a request also emits
  `realtime.invalidate(workspaceId, ['requests'])` to the workspace room. Existing keys stay: mobile
  caches `freeze-requests:<ws>` and `members:<ws>:pending` hang off them (`HomeScreen.tsx:206`,
  `ClubInviteScreen.tsx:84-87`). The writers:
  - join:
    - `join-request.service.ts:131,162` (request created or auto-approved);
    - `add-workspace-member.handler.ts:195`;
    - `invite-workspace-member.handler.ts:277` (its approve path, `:243`);
    - `reject-pending-member.handler.ts:64`;
  - freeze: the four freeze handlers (`request-subscription-freeze.handler.ts:155`,
    `approve-…:120`, `decline-…:82`, `cancel-…:68`). The rule for implementers: every `invalidate`
    that lists `freeze-requests` lists `requests` too. That covers
    `remove-workspace-member.handler.ts:108`, `my-memberships/leave-workspace.handler.ts:89`,
    `member-subscriptions/cancel-subscription.handler.ts:65` and the demo reset list
    `reset-platform-demo-club.handler.ts:19`;
  - personal: request, accept, propose, decline and cancel (`request-…:126`, `accept-…:139`,
    `propose-…:95`, `decline-…:74`, `cancel-…:112`). They add a workspace `invalidate(['requests'])`
    next to their `invalidateUsers`;
  - video: `complete-my-video-review-upload.handler.ts` (after `notifyCoachesOfReview`),
    `set-video-review-status.handler.ts`, `delete-my-video-review.handler.ts`.

  The payload is only resource names, as with `members`, so a student's socket receiving it learns
  nothing. A pinning spec greps the handlers listed above for `'requests'`, in the style of the
  route-tier specs.
- **Join reject** (`features/reject-pending-member/`):
  1. Optional body `RejectPendingMemberInput { comment?: string }` (trimmed, ≤ 500). Mobile keeps calling
     without a body.
  2. A staff-role pending row → `assertCanManageRoles` with the approve message's wording: «Отклонить
     заявку тренера… может только владелец или администратор клуба». This is the same check as
     `add-workspace-member.handler.ts:126-135`.
  3. After the update: `joinRequests.notifyDeclined({ userId, workspaceId, workspaceName, membershipId,
     comment })`. It writes an inbox entry with kind `member.join_declined`, `refId = membershipId`, topic
     «Заявка в клуб «X» отклонена», message = the comment or «Если это ошибка — свяжитесь с клубом.».
     There is no e-mail (§10).
  4. Audit `member.rejectPending` metadata gains `comment`.
- **`list-pending-users.handler.ts:46`**: `createdAt` = the membership's `createdAt` (the request time).
  The type doesn't change, so it is not a contract break. Mobile «Заявки» on the invite screen gets the
  right date too.
- **`join-request.service.ts:361-362`**: the owner's «pending-member» e-mail links to
  `/workspace/:id/users/requests`.
- **`domains/notifications/notification-mute.ts`**: add `member.join_declined` to `EXEMPT_KINDS`, next to
  `member.approved` (a membership notice).

### 3.5 Notifications on decision (member side)

| Decision | Kind | Exists? | Who gets it |
|---|---|---|---|
| Join accepted | `member.approved` (inbox + e-mail) | yes, `join-request.service.ts:174-230` | applicant |
| Join rejected | `member.join_declined` (inbox → push where a device is registered) | **new** (§3.4) | applicant |
| Freeze approved / declined | `freeze.approved` / `freeze.declined` | yes, `approve-…:127-131`, `decline-…:88-92` | member |
| Personal confirmed / new time / declined | `personal.confirmed` / `personal.proposed` / `personal.declined` | yes, `notify-personal-training.ts`; `noticeRecipients` excludes only the actor | member and, when a club-wide viewer acts for the coach, the coach too |
| Video answered | `videoReview.answered` | yes, `video-review-notifications.ts:82-97` | member |
| Video closed | none | as today | — |

Staff-side «new request» notices are unchanged: `member.join_requested`, `freeze.requested`,
`personal.requested`, `videoReview.requested`.

### 3.6 Route tiers

- `GET requests`: `STAFF_ROLES`, coach-scope read. `route-tier-consistency.spec.ts` needs no list
  change.
- `POST members/:userId/reject` stays `SPORT_LEADS` + `assertSportLead`. It adds
  `assertCanManageRoles` for staff rows, the same pairing `addMember` has.

## 4. Admin UI

### 4.1 Where it lives

**«Ученики» becomes a two-tab section: «Список» (`users`) · «Заявки» (`users/requests`).** The sidebar
stays at 11 items.
- `sections.ts` gains `memberTabs`: both tabs `access: "staff"`.
- The sidebar item becomes `{ key: "users", label: "Ученики", icon: Users, tabs: memberTabs }`
  (`workspace-sidebar.tsx:103`).
- Both pages render `<SectionTabs title="Ученики" tabs={memberTabs} badges={…} />` as their header.
  They do this themselves, not through a `users/layout.tsx`, so the member card `users/[userId]` keeps
  its own header.
- «Пригласить» and «⋯ → Импорт» move into the list tab's control row, as «Добавить тариф» sits under
  «Абонементы» (`subscriptions/page.tsx:156-169`).

Why there:
- Every role that decides anything has «Ученики». The plain coach's four items are Сегодня,
  Расписание, Ученики and Удержание (parent §3, Q5).
- All four kinds are a person asking the club for something, and the member card is one click away.
- «Сегодня» is a by-exceptions summary measured at ~700 px (parent wave 5). A working list with
  decline forms and a video player would turn it into a work page. It keeps a single counted row
  instead (§4.5).
- «Удержание» is about churn, and none of these requests is a churn signal.
- A 12th sidebar item would break the parent's IA decision, and «Заявки» is too narrow to deserve it.

**Tab badge.** `SectionTab` gains no field. `SectionTabs` gains an optional
`badges?: Partial<Record<string, number>>` and renders « · N» after a tab label when N > 0. Both
«Ученики» pages pass `{ "users-requests": counts.total }` from `useRequestCounts` (§4.6). This replaces
the amber join block's job of showing that requests are waiting.

**Job.** «любой сотрудник · несколько раз в день · увидеть, что ждёт моего ответа, и ответить».

### 4.2 Layout — `features/requests/RequestsInbox.tsx` (own fetch)

1. `SectionTabs` «Ученики» (Список · Заявки · N).
2. Control row, shown only when `kinds.length > 1`: a «Вид» select. Options: Все · Вступление · Заморозка ·
   {cap(vocabulary.personalSession.nomPl)} · Разборы видео. Only `kinds` are offered, each with its
   count («Заморозка · 2»). The URL holds it (`?kind=`).
3. List, one card with dividers, the house list style:
   - left: one muted kind line («Вступление», «Заморозка», «{personalSession}», «Разбор видео»), then
     the name (+ «Ребёнок» and «Родитель: Имя» as on the roster), then one detail line per kind (§4.3);
   - right: waiting time, muted («2 ч», «3 дня», after 7 days the date «3 нояб.»);
   - the whole row opens the panel (`?request=<id>`). The exception is the `join` row's two buttons
     (§4.3);
   - «Показать ещё» pages (perPage 50);
   - empty after a successful load: «Новых заявок нет». With a filter: «Заявок этого вида нет». Never
     flashed while loading;
   - a failed load: the error line with «Повторить».
4. Realtime: `useWorkspaceRealtime(workspaceId, ["requests"])` reloads the shown pages. An open panel
   whose item left the list after a reload shows «Заявку уже рассмотрели» with «Закрыть», and its
   buttons are gone.
5. A decision that returns 409 or 404 does the same, using the server's message.

### 4.3 Rows

| Kind | Detail line | Row actions |
|---|---|---|
| `join` | e-mail (adult) or «Ребёнок» · club admins also see «роль: {role}» for a staff row | «Принять» (outline) · «Отклонить» (ghost), wave-5 rule: deciding is the row's whole job. «Принять» acts at once (as today). «Отклонить» opens the panel in decline mode, where the inline form is the confirmation (the wave-5 freeze-decline rule) |
| `freeze` | «10 дней с 18 нояб. · БЖЖ 12 · {reason}» (`freezeLine`, moved from `DecisionList.tsx:12-13` into `request-view.ts`) | none |
| `personal` | «пт, 21 нояб., 13:00 · ещё 1 время» in the request's `timezone`. Club-wide viewers who aren't the coach also see « · {coach}» | none |
| `video` | «{title}» · «видео обрабатывается» while `clipStatus = processing` | none |

### 4.4 The panel — `features/requests/RequestSheet.tsx` (side panel, `?request=<id>` opens it)

The panel heading is the kind and the name («Заморозка · Анна Петрова»). Below it are facts, each shown
only when known, and «Открыть карточку ученика» (`users/<userId>`). There is one filled button per
panel. A form swaps the panel body (no panel on a panel). Every form registers `useDirtyGuard(dirty)`;
Esc, outside click and «Отмена» close it through `await confirmLeave()`.

- **Вступление** (`JoinDecision.tsx`):
  - facts: e-mail or «Ребёнок · родитель: …», «заявка от {date}», the role for staff rows;
  - «Принять» (filled) · «Отклонить» (outline);
  - decline mode:
    - «Комментарий (увидит человек)», optional, `FORM_LIMITS.joinReject.comment`;
    - the line «Человек не попадёт в клуб и не сможет подать заявку снова по коду клуба.» (today's
      dialog text, `users/page.tsx:292-293`);
    - «Отклонить заявку» (destructive);
    - no extra `confirmDialog`.
- **Заморозка** (`FreezeDecision.tsx`):
  - facts: абонемент «{plan}, до {subscriptionEndDate}», просит «с {fromDate} на {days} дней (по
    {untilDate})», причина, отправлена;
  - «Одобрить» (filled) swaps in `FreezeForm` prefilled exactly like `SubscriptionFreezeBlock.tsx:209-231`:
    `fromDate` = the requested day or today if past, `endDate = subscriptionEndDate`, submit label
    «Одобрить заморозку»;
  - «Отклонить» (outline) swaps in the comment textarea (`FORM_LIMITS.freeze.declineComment`) and
    «Отклонить заявку» (destructive).
- **Персональная** (`PersonalDecision.tsx`):
  - facts: тренер (when it isn't the viewer), зал, комментарий ученика, отправлена;
  - «Время» is a radio list of `options` («пт, 21 нояб., 13:00 · 60 мин», request time zone), with the
    first one selected;
  - «Подтвердить» (filled) → `accept {optionId}`;
  - «Предложить другое время» (outline) swaps in date, time, «Длительность» (limits from
    `FORM_LIMITS.personalPropose.durationMin`, i.e. 30–180) and an optional comment, then
    «Предложить»;
  - «Отклонить» (ghost) swaps in an optional comment and «Отклонить» (destructive);
  - a viewer acting for another coach sees one muted line: «Вы отвечаете за {coach}: уведомление
    получат ученик и {coach}.»
- **Разбор видео** (`VideoReviewDecision.tsx`):
  - reads `GET video-reviews/:id` (detail with comments) and `GET video-reviews/:id/playback` (`hlsUrl`);
  - facts: title, the member's message, отправлено;
  - `PlyrPlayer` (`features/video-player/plyr-player.tsx`) plays `hlsUrl`. It gains an optional
    `onTimeUpdate(sec)` prop. While processing, the panel shows «Видео ещё обрабатывается»;
  - comments are listed by time («0:42 · текст · автор»). Clicking one seeks the player. The viewer's own
    comment has «⋯ → Удалить» (`confirmDialog`: «Удалить комментарий?» · «Ученик его больше не
    увидит.»);
  - «Комментарий на {m:ss}»: a textarea (`FORM_LIMITS.videoComment.text`, ≤ 2000) and «Добавить», with
    `atSec` = the player's current second;
  - «Отметить отвеченным» (filled; disabled until the clip is `ready`, the server rule «Видео ещё не
    готово») shows the hint «Ученик получит уведомление»;
  - «Закрыть разбор» (ghost) needs no confirm: it is undoable, since staff may reopen
    (`video-reviews-utils.ts` `canSetStatus`);
  - one muted line: «Рисовать на кадре и править комментарии можно в приложении».

### 4.5 «Сегодня»

- `features/dashboard/decisions.ts`: `DECISION_KEYS` replaces `join` and `freeze` with one `requests`
  key in the same position (after «Ожидают оплаты»).
- `DecisionList.tsx` gets row `requests`: «Заявки», count = `counts.total`.
  - The hint is the breakdown of non-zero kinds: «2 на вступление · 1 на заморозку ·
    1 {personalSession.nom} · 1 разбор видео». Plurals come from `request-view.ts`.
  - It links to `users/requests`, or to `users/requests?kind=<k>` when only one kind is non-zero.
  - The freeze unfold, the `freezeRequests` prop and the «И ещё N» line (`:82-128`) are deleted.
- `app/…/workspace/[workspaceId]/page.tsx`:
  - drops `listPendingUsers` (`:92`) and `listPendingFreezeRequests` (`:97`) and reads
    `useRequestCounts`;
  - the page's realtime list swaps `"freeze-requests"` for `"requests"` (`:127`);
  - the role logic for these rows (`:91,96`) is gone: the server scopes the count.
- Every role gets the row when its count > 0. A plain coach therefore now also sees their
  personal-training and video-review requests there.

### 4.6 Shared pieces

- `shared/api/requests.ts`: `listOpenRequests({ workspaceId, kind?, curPage?, perPage? })`, types from
  `ApiTypes.ListOpenRequestsOutputOutput`; ttl 0 (realtime-reloaded data).
- `features/requests/use-request-counts.ts`: calls `listOpenRequests({ perPage: 1 })`, keeps `counts`
  and `kinds`, reloads on `requests`. It goes through `cachedRead("requests:<ws>", …, 0)`, so the
  badge, «Сегодня» and the list share one in-flight request. The one source.
- `shared/api/personal-trainings.ts` (new: accept, propose, decline) and `shared/api/video-reviews.ts`
  (new: get, playback, add comment, delete comment, set status). These are hand-written wrappers over
  `ApiTypes`.
- `shared/api/members.ts`: `rejectPendingMember` gains `comment?`; `listPendingUsers` and `PendingUser`
  are deleted (no admin caller left). `shared/api/subscriptions.ts`: `listPendingFreezeRequests` and
  `PendingFreezeRequest(s)` are deleted. Approve/decline stay, since the card still calls them.
- `shared/lib/contract-limits.ts`: `joinReject.comment` (`RejectPendingMemberInput`),
  `personalPropose.durationMin` / `.comment` (`ProposePersonalTrainingTimeInput`),
  `personalClose.comment` (`ClosePersonalTrainingInput`), `videoComment.text`
  (`AddVideoReviewCommentFeatureInput`).
- `features/audit/audit-meta.ts`: the `member.rejectPending` metadata label «Комментарий».

### 4.7 Elsewhere

- **«Ученики → Список»**: the amber «Заявки на вступление · N» block and its handlers are deleted
  (`users/page.tsx:237-244,272-308,362-405`). The tab badge points to the queue.
- **Member card**: `SubscriptionFreezeBlock` keeps showing and deciding the member's pending request.
  It is part of that abonement's state, as on the mobile coach screen (`CoachMemberSubscriptionScreen.tsx`).
  Both places call the same endpoints and the same `FreezeForm`, so there is still one rule. The inbox
  is the queue, the card is the context.
- **E2E role table**: no `ROLE_MATRIX` entry is needed. `users/requests` is open to all four roles, and
  the smoke crawler follows `[data-section-tabs]` links (parent wave 4), so it visits the tab for every
  role. No route moves, so `LEGACY_REDIRECTS` is unchanged.

## 5. Mobile

- **New notification route:** `member.join_declined` → `null`. The inbox row is the notice, like
  `member.joined` (`features/notifications/notification-route.ts:146-156`). The applicant's own status
  already reads «отклонена» on the no-club screen (`NoWorkspaceScreen.tsx`, `list-my-join-requests` maps
  `BLOCKED` → `rejected`).
- Everything else stays as it is:
  - staff answer personal trainings (`PersonalTrainingScreen.tsx`), freezes
    (`CoachMemberSubscriptionScreen.tsx`), video reviews (`VideoReviewScreen.tsx`) and join requests
    (`ClubInviteScreen.tsx`) where they do today;
  - the realtime `requests` key is ignored by mobile, which has no cache under it [INFERENCE from
    `shared/realtime/realtime.ts:19-27` mapping resources to cache invalidations];
  - `ClubInviteScreen` reject sends no comment (the body is optional).
- A head coach tapping «Отклонить» on a pending staff row in the app now gets the server's 403 message
  instead of rejecting it. This is rare: join-by-code always files a student
  (`join-request.service.ts` `requestMembership`, role `USER`).

## 6. MCP / AI

- **`club_overview`** (`features/mcp/tools/club-tools.ts:137-…`) gains
  `requests: { join, freeze, personal, video }` from `countOpenRequests`.
  - The viewer is built from `AiAccess`: `clubWide = scope.isAdmin`, `clubAdmin = access.isClubAdmin`,
    own-group members for a direction manager.
  - The tool description adds «сколько заявок ждёт решения (вступление, заморозка, персональные, разборы
    видео)».
  - It is the same number as «Сегодня», as the description already promises.
  - Update `docs/mcp.md`.
- **No write tool and no list tool.** A decision needs a person reading the request: dates against
  the abonement, a time that suits the coach, a video. Nobody has asked an assistant to decide them.
  The confirmation-gated action scaffold (`mcp-tool.ts`) stays unused here.

## 7. Tests

Server unit (Prisma mocked; conventions §1 «every handler»):
- `domains/requests/open-requests.spec.ts`:
  - each where-builder per viewer: club admin, head coach (staff applicants excluded), coach (own
    groups, not own request), sections off → null;
  - `openPersonalTrainingWhere` agrees with `displayStatus` on a fixture table: all member options past
    → excluded; `PENDING_MEMBER` → excluded; the viewer as member → excluded;
  - `openVideoReviewWhere`: `uploading` and `failed` clips excluded, `uploaded/processing/ready`
    included;
  - merge order across kinds and page slicing; `counts` ignore `kind`; the 1000 cap.
- `features/requests/list-open-requests.handler.spec.ts`:
  - a `user` role → 403 (`resolveCoachScope`);
  - owner bypass without a member row;
  - plain coach: no `join` in `kinds`/`counts`, `personal` limited to `coachId = me`;
  - head coach: `join` without staff rows;
  - «Абонемент» off → no `freeze`; «Видео» off → no `video`;
  - serialized shape per kind (full row fixtures).
- `reject-pending-member.handler.spec.ts`:
  - comment passed to `notifyDeclined`;
  - a head coach rejecting a staff row → 403, an admin may;
  - realtime `requests`;
  - audit `comment`.
- `join-request.service.spec.ts`: `notifyDeclined` kind, `refId`, topic, fallback message.
- `list-pending-freeze-requests.handler.spec.ts` stays green on the moved where. `list-pending-users`
  gets its first spec: membership `createdAt`.
- Realtime: the specs of each writer in §3.4 assert `'requests'`, plus the grep-pin spec
  `domains/requests/requests-realtime-source.spec.ts`.
- `notification-mute.spec.ts`: `member.join_declined` exempt.
- `club-tools.spec.ts` (or the existing MCP tool spec): `club_overview.requests` per scope.

Server e2e (`apps/server-e2e/src/requests/requests-inbox.e2e-spec.ts`): one club with a pending join,
a freeze request, a personal-training request to a plain coach and an open video review.
- `owner sees every kind, oldest first, with matching counts`
- `head coach sees all kinds but a pending staff applicant`
- `plain coach sees own-group freeze and video, own personal request, no join`
- `deciding through the existing endpoints drops the row and the count` (approve freeze, accept PT,
  reject join, mark video answered)
- `reject with a comment sends member.join_declined to the applicant`
- `a personal request whose times have passed is not listed`
- `kind filter and paging`
- `subscription section off hides freeze requests`

Update `join/join-by-code.e2e-spec.ts` only if it asserts the pending list's `createdAt`.

Admin:
- `features/requests/request-view.spec.ts`: detail line per kind, waiting-time format (hours, days,
  date after 7), personal times in the request zone, dashboard breakdown hint and plurals,
  single-kind link.
- `features/dashboard/decisions.spec.ts`: the `requests` key replaces `join`/`freeze`.
- Render spec `RequestSheet.spec.tsx` (with `<ConfirmDialogHost />`):
  - join decline form, no dialog;
  - freeze approve prefills `FreezeForm`;
  - PT accept sends the chosen `optionId`;
  - video «Отметить отвеченным» disabled while processing;
  - a 409 shows «Заявку уже рассмотрели».
- `section-tabs` spec: badge only when > 0.
- `contract-limits.spec.ts` picks up the four new limits.
- Smoke (`apps/admin-e2e`): no matrix change. The crawl visits `users/requests` for owner, admin, head
  coach and coach. The ACADEMY demo already seeds a pending join, freeze requests and a `PENDING_COACH`
  personal request (`domains/demo/demo-club.plan.ts:816,1224-1238,1978`), so the page is crawled
  populated and checked for `NaN`/`undefined`. The demo has no review clips (they need files); the
  server e2e covers video.

Mobile: `notification-route.spec.ts` covers `member.join_declined` → `null`.

## 8. Rollout

- **One PR, «Заявки»**, on its own branch from `feat/admin-cleanup` (one feature = one branch = one PR):
  - `db push` (one index);
  - contract regen;
  - CHANGELOG: «Ученики → Заявки» and the «Сегодня» row; reject gains an optional comment and the
    applicant is notified; a head coach can no longer reject a pending staff applicant;
  - `docs/mcp.md`; `docs/demo.md` (the tab on the demo club).
- No data migration, no backfill, no breaking API change: a new route, an optional body and a corrected
  date value. The admin wrappers deleted in §4.6 have no other caller.
- Rollback = redeploy the previous image. The index is harmless to old code.

## 9. Acceptance checklist

- [ ] Owner on demo ACADEMY: «Ученики» has tabs «Список · Заявки · N»; the list shows the pending join,
      the freeze requests and the personal request, oldest first; the sidebar still has 11 items.
- [ ] «Сегодня» shows one «Заявки» row whose count equals the tab badge and the list total, with the
      per-kind breakdown; the old join and freeze rows are gone.
- [ ] Accepting or rejecting a join in a row works. Rejecting with a comment delivers «Заявка в клуб «…»
      отклонена» with that comment to the applicant.
- [ ] Approving a freeze from the panel uses the card's form and limits. Declining with a comment
      reaches the member. The card shows the same request until it is decided.
- [ ] A sport lead confirms a coach's personal request from the panel: an attendance session is
      created, and both member and coach are notified. «Предложить другое время» sends `personal.proposed`.
- [ ] An open video review plays in the panel. A comment at the current second appears in the app.
      «Отметить отвеченным» notifies the member and removes the row.
- [ ] Plain coach (`pedagog@ritm.demo`): sees only own-group freezes and video reviews and their own
      personal requests; no joins. Head coach: no pending staff applicants. `GET requests` as a
      student → 403.
- [ ] A decision made in the mobile app removes the row from an open admin list without a reload.
- [ ] Two staff deciding the same item: the second sees «Заявку уже рассмотрели», nothing is applied
      twice.
- [ ] A club with «Абонемент» off has no freeze kind; with «Видео» off no video kind.
- [ ] tsc (server, admin, mobile), tests, contract drift, admin smoke for the four roles green.

## 10. Decisions

- **Scope = four kinds**: join, freeze, personal training (`PENDING_COACH`, not expired), video review
  (open, clip not uploading or failed). Waitlists, drop-ins, grading candidates, substitutions,
  invitations and platform requests are out (table «What counts as a request»).
- **The inbox lists only what the viewer may decide.** No read-only rows. A head coach doesn't see
  staff applicants. A club-wide viewer sees every personal request because they may act for the coach
  (existing `resolvePersonalTrainingActor`).
- **«Ученики → Заявки» tab, not a 12th item and not a list on «Сегодня».** «Сегодня» keeps one counted
  row. The amber join block on the roster goes, replaced by the tab badge. One queue, one place.
- **Freeze stays decidable in the member card** too. It is the abonement's state, and both places use
  the same endpoint and form.
- **No new decide endpoints.** The inbox calls the existing ones, so authorization, race handling,
  audit and notifications stay where they are tested.
- **One aggregate read with per-kind where-builders in `domains/requests/`.** Existing staff lists
  (`freeze-requests`, `pending-users`, `video-reviews`) import the same builders, so the dashboard,
  the inbox and mobile can't count differently.
- **Merge-and-slice paging** with `curPage/perPage/total` and a 1000-row depth guard, the journal
  pattern. Pending queues are tens, not thousands.
- **Waiting since = `createdAt`** for every kind, oldest first. A reopened video review keeps its
  original date.
- **A new realtime key `requests`** emitted next to the existing keys rather than replacing them, since
  mobile caches depend on `freeze-requests` and `members`.
- **Join reject notifies the applicant** (inbox entry, optional comment, no e-mail). The approval already
  e-mails. A decline e-mail would be a new template for a message the app already shows («отклонена» on
  the no-club screen).
- **A head coach may no longer reject a pending staff row**, matching approve (`assertCanManageRoles`).
  Visible behaviour change, in the CHANGELOG.
- **«заявка от» = the request date** (membership `createdAt`), fixed in `GET pending-users` too, since
  that handler now shares the where-builder.
- **`GET pending-users` stays `STAFF_ROLES`.** Mobile shows applicants to every coach by design.
- **Video reviews in the admin** support watching, text comments at a second, deleting one's own
  comment, «отвечено» and «закрыть». Drawing and editing stay in the app. This reuses the existing
  player and endpoints; a web drawing tool has no requester.
- **No money in any row**, so there is nothing to strip. The rule for future kinds is written in §1.
- **AI**: counts in `club_overview` only; no decision tools.
- **One index** (`PersonalTrainingRequest [workspaceId, status, createdAt]`), no new tables.

**(implementation, server S1)** Deviations and details settled while building:
- **Freeze where in two parts.** `freezeRequestScopeWhere` (the old queue body, no section gate) is what
  `GET freeze-requests` imports, so the mobile queue still lists requests filed before «Абонемент» went
  off; the inbox and counts use `pendingFreezeWhere` = that plus the section gate.
- **`reviewStaffMemberWhere({ workspaceId, clubWide, ownGroupMemberIds })`** instead of
  `(rbac, ctx, workspaceId)`: the inbox viewer and the MCP tool (no `RbacService` in its context) build
  the same scope; `list-club-video-reviews` passes `canWriteAllGroups` and `ownGroupMemberIds(ctx)`.
- **«Never their own clip» applies to club-wide viewers too**: answering one's own clip is not a staff
  decision.
- **`loadOpenRequests` returns `{ rows, total, counts }`**: one set of where-builders per read, the counts
  come with the page.
- **Personal `options`** = the member's options still ahead, earliest `startAt` first. A
  `PENDING_COACH` row with no member option at all is not listed (the API can't create one).
- **Reject body optional on the wire.** Express 5 leaves a bodiless POST's body `undefined`, which the
  global zod pipe refuses (the app's call got 400 in e2e). The param is typed with the payload type
  (not the DTO class) and runs `DefaultValuePipe({})` + `ZodValidationPipe(RejectPendingMemberInput)`;
  `@ApiBody({ required: false })` keeps the DTO in the contract (`body?: RejectPendingMemberInput`).
  Audit metadata is `{ comment: null }` without one.
- **No standalone `OpenRequest` type** in the generated client (nested schemas are inlined): the admin
  reads `ListOpenRequestsOutputOutput["data"][number]`.
- **MCP own-group members** are read in `club-tools.ts` with `ownGroupsWhere` (the query of
  `rbac.ownGroupMemberIds`), the viewer's `userId` is the token creator's.
- `video-reviews-utils.spec.ts` (the «member clips stay out of club content» pin) lists
  `domains/requests/open-requests.ts` as a reader of the review tables.
- The join auto-approve path (`requestMembership` with «принимать без подтверждения») also emits
  `requests`; harmless, and every `members` emit of a join writer now carries it.

**(implementation, admin + mobile S2)** Deviations and details settled while building:
- **«Сегодня» breakdown reads «N на …»**: «2 на вступление · 1 на заморозку · 1 на
  {personalSession.acc} · 1 на разбор видео». It agrees with the implied «заявки» in every club's words;
  «N {personalSession.nom}» would need per-noun counting forms («2 индивидуальных занятия»).
- **Personal row**: «ещё 1 вариант / 2 варианта», not «ещё 1 время».
- **Waiting time** also covers the first hour: «только что», «25 мин»; a week or more shows the date.
- **Join row detail**: a child gets the roster's «Ребёнок» badge by the name, so the detail line holds
  only the e-mail (adult) and the staff role; the panel shows «Ребёнок · Родитель: …».
- **No «Открыть карточку ученика» on a join panel**: the applicant has no card until accepted.
- **The inbox page's tab badge reads its own list response** (`counts.total` of the same read), so the
  page makes no second request; the roster tab and «Сегодня» use `useRequestCounts`
  (`cachedRead("requests:<ws>")`).
- **«Сегодня» realtime**: the page list drops `freeze-requests` and does not add `requests`;
  `useRequestCounts` reloads itself on `requests`, so the count is not fetched twice per signal.
- **The freeze approve form is not dirty-guarded**: `FreezeForm` is reused unchanged and opens with the
  member's own values; the decline, propose, personal-decline and video-comment forms are guarded.
- **Video**: the comment form and «Отметить отвеченным» need a processed clip (no player, no second);
  `PlyrPlayer` gained `onTimeUpdate` and a `ref` with `seek(sec)` for clicking a comment.
- **CSP needed no change** (§12): `media-src` and `connect-src` already list the API origin (the
  `review-clips/:id/manifest.m3u8` playlist) and object storage (segments). Checked on the running app:
  a review clip played in the panel with no CSP violation and no failed media request.
- **Audit labels need no change**: `comment` is already «Комментарий» in `META_KEY_LABEL`, which every
  action shares, so `member.rejectPending`'s new key is labelled.
- **`videoComment.text`** reads `AddVideoReviewCommentInputSchema` (the generated name).
- **Admin e2e**: every role's `tabs` gains `users/requests?kind=freeze`, the filtered view the
  «Сегодня» row links to when one kind waits (a kind the role has none of falls back to «Все»). The tab
  itself is crawled from the section tab row, as §4.7 says.

## 11. Implementation slices

One PR, two parallel slices. The server slice commits its DTOs and controller first, with the contract
regenerated, so the admin slice typechecks against real types. Nobody runs the full gate mid-flight;
the integrator runs it once.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server | `apps/server/prisma/schema.prisma` (index); `apps/server/src/domains/requests/**` (+specs); `features/requests/**` (feature, handler, controller, `schemas.ts`, spec); `app/app.module.ts`; `features/subscription-freeze-requests/{list-pending-freeze-requests,request-subscription-freeze,approve-subscription-freeze-request,decline-subscription-freeze-request,cancel-subscription-freeze-request}.handler.ts` (+specs); `features/list-pending-users/**`; `features/reject-pending-member/**`; `features/add-workspace-member/add-workspace-member.handler.ts` (+spec); `features/invite-workspace-member/invite-workspace-member.handler.ts`; `domains/workspace/services/join-request.service.ts` (+spec); `features/personal-trainings/{request,accept,propose,decline,cancel}-personal-training.handler.ts` (+specs); `features/video-reviews/{complete-my-video-review-upload,set-video-review-status,delete-my-video-review,list-club-video-reviews}.handler.ts`, `review-clip-access.ts`, `video-reviews.handler.spec.ts`; `features/remove-workspace-member/remove-workspace-member.handler.ts`; `features/my-memberships/leave-workspace.handler.ts`; `features/member-subscriptions/cancel-subscription.handler.ts`; `features/platform/reset-platform-demo-club.handler.ts`; `domains/notifications/notification-mute.ts` (+spec); `features/mcp/tools/club-tools.ts` (+spec); `docs/mcp.md`; `apps/server-e2e/src/requests/requests-inbox.e2e-spec.ts`; `open-api.json`; `libs/api-client/src/openapi/*` | M (≈ 2.5 implementer-days) |
| S2 admin + mobile | `apps/admin/src/features/requests/**` (`RequestsInbox`, `RequestSheet`, `JoinDecision`, `FreezeDecision`, `PersonalDecision`, `VideoReviewDecision`, `request-view` (+spec), `use-request-counts`, render spec); `app/(dashboard)/workspace/[workspaceId]/users/requests/page.tsx` (new); `…/users/page.tsx`; `…/sections.ts`; `…/workspace-sidebar.tsx` (users item → tabs); `…/page.tsx` («Сегодня»); `shared/workspace/section-tabs.tsx` (+spec); `features/dashboard/{DecisionList.tsx,decisions.ts,decisions.spec.ts}`; `shared/api/{requests,personal-trainings,video-reviews}.ts` (new), `shared/api/{members,subscriptions}.ts`; `features/video-player/plyr-player.tsx` (`onTimeUpdate`); `shared/lib/contract-limits.ts` (+spec); `features/audit/audit-meta.ts`; `apps/mobile/src/features/notifications/notification-route.ts` (+spec); CHANGELOG; `docs/demo.md` | M (≈ 3 implementer-days) |

Interface between the slices: §3.2 (`GET requests`, `ListOpenRequestsQuery`, `ListOpenRequestsOutput`,
`OpenRequest`), §3.4 (`RejectPendingMemberInput`), realtime key `requests`, and notification kind
`member.join_declined`.

Checks for the integrator:
- tsc server / admin / mobile;
- `npx nx test @clubspace/server -- requests`, `-- reject-pending-member`, `-- join-request`,
  `-- freeze`, `-- personal-training`, `-- video-reviews`, `-- notification-mute`, `-- club-tools`,
  `-- route-tier-consistency`;
- admin and mobile unit tests;
- server e2e `requests/*`, `subscriptions/freeze-request`, `personal-trainings/*`, `join/*`;
- contract drift;
- `npm run test:admin-e2e` for the four roles;
- `cs-reviewer` before merge.

## 12. Open risks

- **CSP for review clips in the admin.** `hlsUrl` points at the API's `review-clips/:id/manifest.m3u8`
  (`get-video-review-playback.handler.ts:39`). The admin's `content-security-policy.ts` must allow that
  origin for media and XHR as it does for course videos [INFERENCE: not verified that the same origin
  is already listed]. S2 checks this on the running app.
- **Applicants rarely have push.** A pending user hasn't been asked for push permission yet
  (`join-request.service.ts:171-173`). So `member.join_declined` is mostly read when they open the app,
  where the status already says «отклонена». Accepted; no e-mail by decision.
- **Time-based changes emit nothing.** A personal request expiring, or the video worker marking a clip
  `failed` (`apps/video-worker`), leaves the list on the next load or the next `requests` signal, not
  instantly.
- **Workspace-room fan-out.** `requests` goes to every socket in the club, students included, as
  `members` already does. Writers are human-paced; `invalidateCoalesced` is available if it ever
  matters.
- **Head-coach behaviour change** on rejecting pending staff rows (§3.4). Mobile shows the button to
  sport leads, so a head coach gets a 403 text on such a row. Rare (join-by-code files students only).
- **Admin acting for a coach on personal trainings** books the coach's time without asking them. This is
  today's server rule (`personal-training-access.ts:88-111`); the panel says so and the coach is
  notified.
