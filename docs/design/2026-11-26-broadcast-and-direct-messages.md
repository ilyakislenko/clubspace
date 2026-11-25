# Club messages «Сообщения»: broadcasts to a segment and direct messages (backlog E7)

Status: **design** · 2026-11-26 · base: `main` @ `d434461c`
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E7 («SMS / WhatsApp, broadcast to debtors, direct
message to a member»). Siblings for structure: [requests inbox](2026-11-15-requests-inbox.md),
[discounts](2026-11-15-discounts.md). File:line references are as of `d434461c`. The owner was asleep; every
choice he would normally make is in §11 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас клуб не может написать конкретным людям. Объявление видят все, кому оно адресовано, в ленте, и
написать «должникам» или одному ученику нельзя: ни в админке, ни в приложении.

Что сделаем:
1. **Вкладка «Сообщения» в разделе «Ученики»** (меню по-прежнему 11 пунктов). «Написать» → боковая панель:
   кому, заголовок, текст. Кому: всем ученикам, группам, направлению; кому пора продлить, кто не оплатил, кто
   не был 30 дней, кому стоит позвонить; одному ученику. До отправки видно, сколько человек получат и у
   скольких есть push.
2. **Одному ученику** — из карточки («⋯ → Написать сообщение»), из строки «Кому позвонить» (сразу
   засчитывается как «Связались») и из строки «Продлить».
3. **Каналы:** push и раздел «Сообщения клуба» в приложении всегда; e-mail — если клуб включит его в
   настройках. **SMS пока нет** — провайдера подключим позже.
4. **Статистика:** сколько получили, у скольких был push, сколько открыли и кто именно.
5. **Тихие часы:** с 22:00 до 09:00 по времени клуба сообщение ждёт до 09:00, кроме отмеченных «Срочно».
6. **Отписка:** ученик может отключить «Сообщения клуба» — push не придёт, но сообщение останется в разделе.
   Личные и «служебные» (отмена занятий, оплата) доходят всегда; служебными их помечают только владелец,
   администратор и главный тренер. Реклама сторонних товаров запрещена (закон «О рекламе»).
7. **Кто пишет:** владелец, администратор, главный тренер — всем; руководитель направления — своему
   направлению; тренер — своим группам. Сегменты «не оплатили» и «продлить» — только первым трём.
8. **За детей сообщения получают родители** с именем ребёнка. Каждая отправка — в истории изменений.

## Problem

1. **Only a feed.** The one staff→member channel is `Announcement` (`schema.prisma:2625-2657`): a post to the
   club, a direction or groups (`create-announcement.feature.ts:5-22`) with a one-time push
   (`manage-announcements/notify.ts:57-89`), visible to everyone in the audience, later joiners included
   (`target.ts:179-188`).
2. **«Должники» can't be messaged.** `AnnouncementAudience` is `ALL | EXPIRING` (`schema.prisma:2659-2662`); the
   roster computes `unpaid`/`renew`/`inactive` (`list-workspace-members.feature.ts:21-24`, handler `:41-57`) but
   nothing acts on the result — and a feed post to debtors would be public to the segment.
3. **No direct message.** Member card «⋯» = access + removal (`app/…/users/[userId]/page.tsx:361-385`); the call
   list's only action is «Связались» (`retention/call-list.tsx:324-334`); renew rows are plain links
   (`retention/renew-list.tsx:240-262`). The phone link (`call-list.tsx:300-306`) is the only path.
4. **No read evidence.** `Notification.seen` (`schema.prisma:430`) flips for every unseen row when the inbox opens
   (`apps/mobile/src/features/notifications/NotificationsScreen.tsx:89-92`) — «opened the inbox», not «read».
5. **No quiet hours.** Producers push immediately (`notification-producer.service.ts:50-82`); only scheduled
   jobs pick local hours (`domains/scheduler/daily-club.service.ts:25`, `review-reminders.service.ts:14`).
6. **Unsubscribe is all-or-nothing per club** (`WorkspaceMember.notificationsMuted`, `schema.prisma:1154-1157`;
   exemptions `domains/notifications/notification-mute.ts:7-27`); categories exist only for system producers
   (`NotificationPreferences`, `schema.prisma:442-470`).
7. **Channels:** EMAIL / PUSH / dead TELEGRAM (`schema.prisma:69-74`), no SMS; trial e-mail is capped
   (`trial-limits.service.ts:118-131`).

## Goal / non-goals

**Goal.** A staff member sends a message to a segment of students, or to one student, from the place where they
found those people. The message reaches the student (or the guardians of a child) by push, in the app and
optionally by e-mail. It respects quiet hours, the member's opt-out and the sender's scope. The sender then sees
who received it and who opened it.

**Non-goals** (sketched in §13): two-way chat (the message shows «Связаться с клубом» → «О клубе»); SMS /
WhatsApp / Telegram (no provider); promotional mailings (need prior opt-in, 38-ФЗ ст. 18); messages to staff;
templates and automations; any announcement change beyond the audience cutover (§4.4).

**Ground rules:** as in the [parent spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer) —
additive `db push`, authorize in the handler, `serialize*`, unique names, contract regen; people counts only from
`domains/metrics/*` / `renewal-rules.ts`; vocabulary helper; UI rules (one primary, row tap opens, ≤ 1 trailing,
side panels, `confirmDialog`, `useDirtyGuard`, formal «вы», `pluralRu`).

## 1. The model in one paragraph

A **club message** (`ClubMessage`) is written once and addressed to a **segment**. At send time the segment is
resolved into **recipient rows** (`ClubMessageRecipient`, one per student; a child is the recipient and its
guardians get the deliveries). Each recipient gets an in-app copy. The app's «Сообщения клуба» reads recipient
rows, so the message stays readable even when push was suppressed. Unless suppressed, the recipient also gets a
push and inbox notification, and an e-mail when the club and the message enable it. Opening the message in the
app stamps `readAt`, which is the «открыли» number. Announcements stay the club's *feed*. Messages are
*deliveries to people*. One job, one place (§11).

## 2. Segments and scope

| Segment | Who (students only: `studentWhere`, `domains/metrics/students.ts:18`) | Source of truth | Who may use it |
|---|---|---|---|
| `ALL` | every student in the sender's scope | `studentWhere` ∩ scope | all senders (a coach = students of own groups) |
| `GROUPS` | students of the chosen groups (≤ 100) | `groupMemberships.some` as `announcementMemberWhere` (`notify.ts:28-45`), students only | coach: own groups only (`rbac.assertCanWriteGroup`) |
| `DIRECTION` | students of the direction | `memberOfDirectionWhere` (`domains/directions/direction-scope`) | sport leads; direction manager for own directions (`assertCanManageDirection`) |
| `RENEW` | «Продлить» | `renewalDueUserIds` (`renewal-rules.ts:270`) | sport leads (matrix: renewals ✅ owner/admin/head coach only) |
| `UNPAID` | «Ожидают оплаты» | `awaitingPaymentWhere` (`renewal-rules.ts:303`) | sport leads |
| `INACTIVE` | «Не были на занятиях 30 дней» | `notAttendedWhere` (`domains/metrics/attendance.ts:28`) ∩ scope | all senders in scope |
| `CALL_LIST` | open «Кому позвонить» rows (not snoozed) | `loadCallList` (`domains/retention/call-list.ts:92`) with the sender's scope | all senders (B1 scope: coach = own groups) |
| `MEMBERS` | explicit `userIds` (1–200): the direct message and «написать выбранным» | `studentWhere` ∩ scope per id; any id out of scope → 404 «Ученик не найден» | all senders in scope |

- **Scope** = `rbac.resolveCoachScope(...)`. Sport leads see the whole club. A direction manager or coach sees
  only the groups they act on as their own (`ownGroupsWhere`, `rbac.service.ts:35`), regardless of
  `coachSeesAllGroups`, the same rule as the call list (admin-cleanup B1 decisions).
- **Direct** = `MEMBERS` with one id. The UI calls it «Личное сообщение»; the server stores `isDirect = true`.
- Segments are evaluated **at send time** (a scheduled message sends to whoever is due then). The compose
  preview shows the count «сейчас».
- **Children:** the recipient row is the child (`userId` = dependent). Delivery goes to confirmed guardians
  through `routeToGuardians` (`domains/notifications/guardian-routing.ts:53-75`), with «Миша: …» as the topic.
  A guardian who is also a direct recipient gets one copy per person (existing dedupe by topic + message).

## 3. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
enum ClubMessageSegment { ALL GROUPS DIRECTION RENEW UNPAID INACTIVE CALL_LIST MEMBERS } // one per line in the schema
enum ClubMessageStatus  { SCHEDULED SENT CANCELLED } // SCHEDULED = waiting for sendAt / end of quiet hours

// A message from the club to a segment of its students, or to one student. Not a feed post
// (Announcement): only the recipients resolved at send time see it.
model ClubMessage {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  authorId    String?   @db.Uuid
  author      User?     @relation("ClubMessageAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  authorName  String    @db.VarChar(255) // denormalized: renders after the author is gone
  title       String    @db.VarChar(120)
  body        String    @db.Text         // ≤ 2000 (zod)
  segment     ClubMessageSegment
  directionId String?   @db.Uuid         // DIRECTION; plain id (snapshot outlives the direction)
  groupIds    String[]  @db.Uuid         // GROUPS; plain ids
  memberIds   String[]  @db.Uuid         // MEMBERS (≤ 200)
  isDirect    Boolean   @default(false)
  isService   Boolean   @default(false)  // «служебное»: ignores the opt-out and the club mute
  urgent      Boolean   @default(false)  // ignores quiet hours
  withEmail   Boolean   @default(false)
  status      ClubMessageStatus @default(SCHEDULED)
  sendAt      DateTime  @default(now())
  sentAt      DateTime?
  // Written at send (readCount on each first read): the list needs no aggregate.
  recipientCount Int @default(0)
  pushCount      Int @default(0)
  emailCount     Int @default(0)
  readCount      Int @default(0)
  recipients  ClubMessageRecipient[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([workspaceId, createdAt])
  @@index([status, sendAt]) // the minute dispatcher
  @@index([authorId])
}

model ClubMessageRecipient {
  id          String      @id @default(uuid()) @db.Uuid
  messageId   String      @db.Uuid
  message     ClubMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  workspaceId String      @db.Uuid  // denormalized: the member's list is workspace-scoped
  userId      String      @db.Uuid  // the student; a child, not its guardian
  user        User        @relation("ClubMessageRecipientUser", fields: [userId], references: [id], onDelete: Cascade)
  pushSkip    String?     @db.VarChar(16) // null = push row written; 'muted'|'opted_out'|'no_device'|'cap'
  emailedAt   DateTime?
  readAt      DateTime?
  createdAt   DateTime    @default(now())
  @@unique([messageId, userId]) // new table: allowed
  @@index([workspaceId, userId, createdAt])
  @@index([messageId, readAt])
}
```

Existing tables gain nullable or defaulted columns only:
- `Workspace.messagesEmailEnabled Boolean @default(false)` — the club allows the e-mail channel.
- `NotificationPreferences.clubMessagesEnabled Boolean @default(true)` — push and inbox for non-service
  broadcasts.
- `NotificationPreferences.clubMessagesEmailEnabled Boolean @default(true)` — e-mail copies; the one-click
  unsubscribe sets it to `false`.
- Relations on `User` (`ClubMessageAuthor`, `ClubMessageRecipientUser`) and `Workspace.clubMessages`.
- `AnnouncementAudience` keeps `EXPIRING` for stored rows (§4.4). Removing an enum value needs owner consent,
  the `TELEGRAM` precedent at `schema.prisma:72-73`.

No backfill. `deploy/update.sh` `migrations()` needs nothing.

## 4. Server

### 4.1 Domain — `apps/server/src/domains/messages/`

- `segments.ts` — `resolveSegmentUserIds(prisma, { workspaceId, ownerId, segment, directionId, groupIds,
  memberIds, scope, now })`. Returns student `userId`s. It calls only the functions in the §2 table and
  intersects them with `scope` (a `Prisma.WorkspaceMemberWhereInput` built from `ownGroupsWhere` when the
  sender isn't club-wide). `CALL_LIST` takes the ids of `loadCallList`'s open rows. Pure where-building lives
  in `segment-where.ts` (unit-tested directly).
- `domains/notifications/quiet-hours.ts` (pure; also used by the federation design): `QUIET_START_HOUR = 22`,
  `QUIET_END_HOUR = 9`, `isQuietHour(now, tz)` (via `localHourInTz`, `domains/scheduler/clubs-due.ts:13`),
  `nextSendAt(now, tz)` (now if allowed, else the next 09:00 club-local via `wallClockToUtc`).
- `limits.ts` (pure + one count): per club 10 non-direct messages per club-local day; a coach or direction
  manager 3 non-direct per day; anyone 50 direct per day; urgent 2 per sender per day → `BadRequestError` naming
  the limit («Сегодня клуб уже отправил 10 рассылок — следующая завтра»). Per recipient: ≤ 3 non-service
  broadcast **pushes** per club-local day; past that the in-app copy is written with `pushSkip = 'cap'`.
- `deliver.ts` — `deliverClubMessage(deps, messageId, now)`, the only writer of recipients:
  1. Claim: `updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENT', sentAt: now } })`;
     `count === 0` → return (the status flip is the dedupe; no `NotificationDispatchLog`).
  2. Resolve (§2), keep `ACTIVE` members, `createMany` recipient rows (chunks of 500).
  3. Push + inbox, kind `message.direct` | `message.service` | `message.broadcast`. Broadcast drops
     `clubMessagesEnabled = false` (`'opted_out'`); `filterMuted` drops muted (`'muted'`); the daily cap; then
     `producer.writeMany(rows)` (mute, guardian routing, batch insert, queue — `notification-producer.service.ts:50-82`).
     Topic = title, message = body ≤ 200 chars, metadata `{ kind, workspaceId, messageId }`. No `FirebaseDevice` /
     `WebPushSubscription` (own or guardians') → `'no_device'`, inbox row still written.
  4. E-mail if `withEmail && workspace.messagesEmailEnabled`, to the recipient's (or a child's guardians')
     e-mail where `clubMessagesEmailEnabled !== false`, via `NotificationsService.sendNotification` (`EMAIL`,
     template `club-message`, `trialEmailWorkspaceId` → trial allowance applies); `emailedAt` per row.
  5. Counters; `realtime.invalidateUsers(addressed + guardians, ['club-messages'])`;
     `realtime.invalidateCoalesced(workspaceId, ['messages'])`.
- `NotificationProducerService.filterOptedIn` (`:259`) becomes public; `NotificationCategoryKey` gains
  `clubMessagesEnabled`. `notification-mute.ts` `EXEMPT_KINDS` gains `message.direct`, `message.service`.

### 4.2 Endpoints — `apps/server/src/features/club-messages/`

Controller `workspaces/:workspaceId/messages`, guards `AuthGuard, WorkspaceMemberGuard, RoleGuard`.

| Method · route | `@Roles` | Handler check | Name (unique) |
|---|---|---|---|
| `POST messages/preview` | `COACHING_ROLES` | scope + segment rights (§2) | `previewClubMessage` |
| `POST messages` | `COACHING_ROLES` | same + `isService` → `assertSportLead`; limits; `RENEW`/`UNPAID` → `assertSportLead` | `sendClubMessage` |
| `GET messages` | `COACHING_ROLES` | sport leads: all; others: authored by me | `listClubMessages` |
| `GET messages/:messageId` | `COACHING_ROLES` | as list; 404 otherwise | `getClubMessage` |
| `GET messages/:messageId/recipients` | `COACHING_ROLES` | as list; rows limited to the viewer's scope | `listClubMessageRecipients` |
| `POST messages/:messageId/cancel` | `COACHING_ROLES` | `SCHEDULED` only; author or sport lead | `cancelClubMessage` |
| `GET me/messages` | — (any member, act-as ok) | own recipient rows in this club | `listMyClubMessages` |
| `GET me/messages/:messageId` | — | own row else 404 | `getMyClubMessage` |
| `POST me/messages/:messageId/read` | — | own row; idempotent (`readAt` null → now, `readCount + 1` in one tx) | `markClubMessageRead` |

DTOs:
- `PreviewClubMessageInput` = `{ segment, directionId?, groupIds?, memberIds?, isService?, urgent?, withEmail?,
  sendAt? }` (a flat `z.object` + `superRefine`, no union, conventions §1).
- `PreviewClubMessageOutput` = `{ recipients, children, withPush, optedOut, muted, withEmail, emailAllowance:
  number | null, sendAt, deferredByQuietHours: boolean, limits: { clubLeft, senderLeft, urgentLeft } }`.
- `SendClubMessageInput` = preview input + `title (1–120)`, `body (1–2000)`, `logContact?: boolean`.
- `ClubMessageOutput` = `{ id, title, body, authorName, segment, audienceLabel, isDirect, isService, urgent,
  withEmail, status, sendAt, sentAt, recipientCount, pushCount, emailCount, readCount, createdAt }`.
  `audienceLabel` is built server-side: «Группы: Дети 7–9, Взрослые утро», «Продлить», «Иван Петров».
- `ClubMessageRecipientOutput` = `{ userId, name, isDependent, guardianNames, pushSkip, emailedAt, readAt }`.
- `MyClubMessageOutput` = `{ id, title, body, authorName, sentAt, readAt, club: { name, logoUrl } }`.

Paging `curPage/perPage/total` (50, max 200) on every list.

**Send rules.** `sendAt = max(now, payload.sendAt)` (≤ 30 days ahead); unless `urgent`,
`sendAt = nextSendAt(sendAt, workspace.timezone)`. Effective `sendAt ≤ now` → the handler delivers inline after
the commit (the response carries counters); otherwise the dispatcher sends it. `withEmail` with the club e-mail
off → 400 «E-mail для сообщений выключен в настройках клуба». `logContact` only for a direct message to a member
on the sender's open call list: writes the contact as `LogAtRiskContactHandler` does (note «Сообщение:
<title>») and calls `CallListCacheService.invalidate(workspaceId)` (conventions §1).

**Dispatcher.** `RemindersService.run` (`domains/scheduler/reminders.service.ts:103`; the minute job,
`scheduler.processors.ts:75-86`) gains `dispatchDueClubMessages(now)`: `SCHEDULED`, `sendAt ≤ now`, take 50;
non-urgent ones wait while `isQuietHour(now, tz)` (covers a club that changed its zone); else deliver.

**Audit:** `message.send` (`targetType 'clubMessage'`, metadata `{ segment, recipients, isDirect, isService,
urgent, withEmail, sendAt }`, no body copy) and `message.cancel`; added to `AuditAction` and
`features/audit/audit-meta.ts`. **Realtime:** `messages` (staff lists, coalesced), `club-messages` (recipients).
**E-mail:** template `club-message` (club, title, body, «Открыть в приложении»), footer «Отписаться от писем
клуба» → `GET /public/unsubscribe/club-messages?token=` (HMAC of `userId`, no login) sets
`clubMessagesEmailEnabled = false`; `List-Unsubscribe` header.

### 4.3 Route tiers

`route-tier-consistency.spec.ts` covers the controller: `COACHING_ROLES` + `resolveCoachScope`; the
`assertSportLead` branches (`RENEW`, `UNPAID`, `isService`) sit inside, as «assign subscription» does — pinned in
the spec's exceptions with a comment. Member routes have no `@Roles` and accept `X-Act-As`.

### 4.4 Announcements cutover (one place per job)

«Только на продление» (`EXPIRING`) is a private nudge to a segment, which is the job of «Сообщения → Продлить».
- `CreateAnnouncementInputSchema.audience` and the update twin accept only `'ALL'`, or drop the field. An old
  client sending `EXPIRING` gets 400 «Используйте «Сообщения → Продлить»».
- The admin form drops the option (`features/announcements/AnnouncementFormSheet.tsx`).
- Stored `EXPIRING` rows keep their filter (`announcementMemberWhere`, `notify.ts:47-49`, and the feed) until
  they are deleted, so nothing widens.
- The glossary row `renewals_due` loses «announcement audience» from «Shown on» and gains «Сообщения (сегмент
  «Продлить»)».

## 5. Admin UI

### 5.1 Where it lives — «Ученики → Сообщения» (`users/messages`)

- New tab in `memberTabs` (`app/…/workspace/[workspaceId]/sections.ts:11-24`): `{ key: "users-messages", label:
  "Сообщения", path: "users/messages", access: "staff" }`. No sidebar item: messages go to students, segments
  are roster filters, and a plain coach already has «Ученики».
- `features/messages/MessagesPage.tsx` (own fetch): the one primary «Написать»; rows = title · audience label ·
  «12 ноя, 18:40» / «Отправится в 09:00» · «Открыли 34 из 52», a colour dot + tooltip for service / urgent /
  e-mail (no chips). Row tap → `MessageDetailSheet`: body, flags, counters, paged recipients («Открыл(а) 12 ноя»
  / «Не открыл(а)», push reason muted: «без push: отключил(а) сообщения»); scheduled → «⋯ → Отменить отправку»
  (`confirmDialog` «Сообщение не уйдёт 52 ученикам»). Reloads on `messages`.

### 5.2 Compose — `features/messages/ComposeMessageSheet.tsx` (side panel, `?compose=1`)

- «Кому»: §2 segments filtered by role (`isSportLead`); a plain coach sees «Все мои ученики · Группы · Не были
  30 дней · Кому позвонить». Groups / direction reuse `AnnouncementTargetPicker` with `allowedDirectionIds`
  (`useDirectionScope`). Opened prefilled → a read-only line («Иван Петров», «Продлить · 93 ученика») + «Изменить».
- «Заголовок», «Текст» with `FORM_LIMITS.clubMessage.*` and a counter. Checkboxes, each only when allowed:
  «Служебное — дойдёт и тем, кто отключил сообщения клуба» (sport leads), «Срочно — отправить сейчас, даже
  ночью», «Также отправить на e-mail» (club switch on). «Отправить позже» → date-time (club zone).
- Preview line under the form (debounced `previewClubMessage`), for example: «Получат 52 ученика (3 ребёнка —
  их родителям). Push — 40, отключили сообщения — 4, без приложения — 8. Сейчас тихие часы: уйдёт в 09:00.»
  When the trial e-mail allowance is short: «E-mail: осталось 12 писем пробного периода».
- Hint: «Пишите о занятиях клуба. Реклама сторонних товаров запрещена.»
- Primary «Отправить» (or «Запланировать»). No confirm for ≤ 1 recipient. Otherwise `confirmDialog` «Отправить
  52 ученикам?», plus «Сейчас ночь у учеников» when `urgent` during quiet hours.
- `useDirtyGuard`. On 400 the limit message is shown inline.

### 5.3 Entry points

- **Ученики list** (`app/…/users/page.tsx`): when a segment filter is active (`renew`, `unpaid`, `inactive`)
  or rows are selected, the header's existing «⋯» gains «Написать этим ученикам (N)», which opens compose
  prefilled. Selection lives in the page as today [INFERENCE: if the roster has no row selection, only the
  filter path ships; no checkbox column is added for this].
- **Member card** (`users/[userId]/page.tsx:361-385`): the «⋯» gains «Написать сообщение» first. The menu is
  shown to `COACHING_ROLES` in scope, not only `canEditMember`: a coach may write to own students. A block
  «Сообщения» (last 5 with «открыто»/«не открыто», «Все» → `users/messages?userId=`) renders only when there
  are any. `GET messages?userId=` filters by recipient within the viewer's visibility.
- **Кому позвонить** (`retention/call-list.tsx`): the expanded contact row (`:336-370`) gets a secondary
  «Написать сообщение» next to «Сохранить». It opens compose for that member with `logContact: true`, so
  writing counts as «Связались». The page header gains a secondary «Написать всем (N)» → segment `CALL_LIST`.
- **Продлить** (`retention/renew-list.tsx`): each renew row gets one trailing icon button (`MessageSquare`,
  `aria-label="Написать"`) outside the row link. The section headers «Продлить» and «Ожидают оплаты» get a
  secondary «Написать всем» → `RENEW` / `UNPAID`.
- **Настройки → Уведомления** (`settings/notifications`): a toggle «Сообщения ученикам на e-mail» next to the
  digest toggle (club admin; `PATCH settings` `messagesEmailEnabled`). Help text names the trial allowance.

### 5.4 Shared pieces

- `shared/api/messages.ts` wrappers (`ApiTypes.*`), `features/messages/message-view.ts`: audience label
  fallback, counters line, push reason text, plurals.
- `apps/admin-e2e/src/role-matrix.ts`: `users/messages` for owner, admin, head coach, direction manager and coach.

## 6. Mobile

- **Member:** `features/messages/ClubMessagesScreen.tsx` (recipient rows of the current club, unread dot from
  `readAt`) and `ClubMessageScreen.tsx` (`{ messageId }`: title, body, «от <authorName>, <date>», «Связаться с
  клубом» → `ClubAbout`; calls `markClubMessageRead` on open), on the root stack (`app/navigation.ts`, `App.tsx`).
  `SIDEBAR_SECTIONS` gains «Сообщения клуба» (no flag). `notification-route.ts`: `message.*` → `ClubMessage`,
  `dependentId` switches to the child as for other kinds; acting as a child lists the child's rows.
- **Settings** (`features/profile/SettingsScreen.tsx`): «Сообщения клуба» → `clubMessagesEnabled` («Личные и
  служебные сообщения приходят всегда»); «Сообщения клуба на e-mail» → `clubMessagesEmailEnabled` (account has
  an e-mail).
- **Staff:** `ComposeClubMessageScreen.tsx` (root stack, `{ segment, groupIds?, memberIds?, logContact? }`) from
  `AtRiskMemberCard` «Написать» (with `logContact`), the `SessionAttendance` header «Написать группе» and the
  `MemberSubscription` header; same preview and checkboxes; history stays in the admin.

## 7. MCP / AI

- `club_overview` (`features/mcp/tools/club-tools.ts:182`) gains `messages: { sent30d, recipients30d,
  readShare }`, scoped like the list (sport leads: club; others: authored by the token creator).
- **No send tool.** `MCP_ACTION_TOOLS` stays empty (`features/mcp/mcp-actions.ts:36`): sending to people needs a
  person to read the preview. `docs/mcp.md` updated.

## 8. Demo generator

`domains/demo/demo-club.plan.ts` (ACADEMY) gains `plan.clubMessages` and `writeDemoClubPlan` writes them
(`demo-club.writer.ts`). It is deterministic (`demoUuid`), dated relative to the reset:
1. «Тренировок 4 ноября не будет» — `ALL`, service, sent 3 weeks ago, 81% read.
2. «Семинар по работе из гарда в субботу» — `DIRECTION` BJJ, by `bjj@academy.demo`, 64% read.
3. «Ваш абонемент заканчивается» — `RENEW`, by `admin@academy.demo`, 47% read.
4. «Напоминаем об оплате абонемента» — `UNPAID`, service, e-mail on, 60% read.
5. «Давно вас не видели — ждём на тренировке» — `INACTIVE` in own groups, by `coach@academy.demo`, 30% read.
6. Direct «Максим, возьмите кимоно на аттестацию» → `student@academy.demo`, unread, so it shows in his inbox.
7. Direct to a child of `parent@academy.demo` («Миша: форма на соревнования»), so the guardian path is visible.
8. Scheduled «Расписание на праздники» for tomorrow 09:00 (status `SCHEDULED`; the next reset re-dates it).

Inbox `Notification` rows (`sent: true`, no push) are written only for the fixed demo accounts. Generated
students have no devices (docs/demo.md «Чего нет»). Ритм (`ritm-demo.plan.ts`) gets two: «Отчётный концерт:
костюмы» (`GROUPS`) and one direct. `ACADEMY.messagesEmailEnabled = true`. `docs/demo.md`: the scenario line
«Удержание → Кому позвонить → Написать сообщение».

## 9. Tests

Server unit (Prisma mocked, conventions §1):
- `domains/messages/segment-where.spec.ts`: each segment × scope (club-wide, direction manager, coach); a group
  of another club → 404; `MEMBERS` out of scope → 404; `CALL_LIST` uses open rows only.
- `quiet-hours.spec.ts`: 21:59 / 22:00 / 08:59 / 09:00 in `Asia/Tomsk` and `America/New_York` (west of UTC);
  `nextSendAt` across midnight and across a DST change.
- `limits.spec.ts`: club 10/day, coach 3/day, direct 50/day, urgent 2/day, club-local day boundary; per-recipient
  cap → `pushSkip 'cap'`.
- `deliver.spec.ts`: claim flip (second run no-op); opted-out broadcast vs service vs direct; muted; guardian
  routing for a child (row stays the child's); `no_device`; e-mail only when both flags are on and the
  preference allows; trial allowance exhausted → `emailedAt` null; counters; realtime keys.
- `send-club-message.handler.spec.ts`: role `user` 403; owner bypass without a member row; coach → 403 on
  `UNPAID`/`RENEW`/foreign group/`isService`; direction manager → 403 on another direction; e-mail off → 400; quiet
  hours → `SCHEDULED` at 09:00, `urgent` → sent; `logContact` writes + invalidates, refused when not direct; audit.
- `cancel-club-message`, `list-club-messages` (scope: coach sees own only), `list-club-message-recipients`
  (rows outside scope hidden), `mark-club-message-read` (idempotent; act-as child marks the child's row;
  foreign → 404), `list-my-club-messages`.
- `notification-mute.spec.ts`: `message.direct`, `message.service` exempt; `message.broadcast` muted.
- `reminders.service.spec.ts`: due messages dispatched; non-urgent during quiet hours skipped.
- `create-announcement.handler.spec.ts`: `EXPIRING` → 400. `route-tier-consistency.spec.ts` green with the new
  controller.

Server e2e `apps/server-e2e/src/messages/club-messages.e2e-spec.ts`:
- `owner sends to unpaid students and they get push and an in-app message`
- `coach can message own group but not another group or the unpaid segment`
- `a child's message reaches its guardians with the child's name and opening it marks the child's row read`
- `opted-out member gets no push for a broadcast but gets a service and a direct message`
- `message composed at 23:00 club time is held until 09:00 unless urgent`
- `daily club limit refuses the 11th broadcast`
- `direct message from the call list logs the contact and drops the member from the list`
- `e-mail copy honours the club switch and the member unsubscribe link`
- `cancelling a scheduled message prevents delivery`

Admin:
- `features/messages/message-view.spec.ts` (labels, preview sentence, plurals, push reasons);
- `ComposeMessageSheet.spec.tsx` (with `<ConfirmDialogHost />`): role-filtered segments, the service checkbox
  hidden for a coach, the confirm for > 1 recipient, the limit error inline;
- `renew-list.spec.tsx`: the trailing icon opens compose with the member;
- `contract-limits.spec.ts`: new limits;
- admin e2e: the role matrix adds `users/messages`, and the crawl checks it populated (demo has 8 messages).

Mobile: `notification-route.spec.ts` maps the three kinds; a `club-messages` helper spec (unread state).

## 10. Acceptance checklist

- [ ] Owner on ACADEMY: «Ученики» has tabs «Список · Заявки · Сообщения»; the sidebar still has 11 items; the
      demo list shows 8 messages with «Открыли N из M».
- [ ] «Написать» → «Не оплатили» shows the same count as «Продлить → Ожидают оплаты»; sending delivers push +
      «Сообщения клуба» to those students; the audit shows `message.send`.
- [ ] Member card «⋯ → Написать сообщение» sends a direct message; it appears in the card's «Сообщения» block.
- [ ] «Кому позвонить» → «Написать сообщение» sends and removes the member from the list on every surface.
- [ ] A renew row's icon opens compose for that member.
- [ ] `coach@academy.demo` (head coach) can use «Продлить» and «Не оплатили». The BJJ manager sees only BJJ
      groups and the direction. A plain coach (`pedagog@ritm.demo`) sees only own groups, the 30-day and
      call-list segments, and no «Служебное».
- [ ] At 23:00 club time a non-urgent message shows «Отправится в 09:00» and arrives at 09:00; «Срочно» arrives
      at once; the 3rd urgent of the day is refused.
- [ ] A member who switched off «Сообщения клуба» gets no push for a broadcast. A service or direct message
      still arrives. Every message is in «Сообщения клуба».
- [ ] A child's message reaches the parent as «Миша: …». Opening it marks it read in the admin.
- [ ] The e-mail copy goes only with the club switch on, and the unsubscribe link stops further e-mails.
- [ ] The announcement form no longer offers «Только на продление».
- [ ] tsc (server, admin, mobile), unit tests, server e2e `messages/*`, contract drift, admin e2e for the
      four roles green.

## 11. Decisions

- **A new «Сообщения», not an extension of announcements.** An announcement is a *feed post* (whoever is in the
  audience sees it, now and later, no per-person delivery). A message is a *delivery*: recipients frozen at send,
  private (an unpaid student must not see a «for debtors» post), per-person read state, 1:1 included. Merging
  would put debtor nudges into the feed or receipts onto every post. «Новости и события → Объявления»
  publishes; «Ученики → Сообщения» sends to people.
- **«Только на продление» moves to messages** (new posts refused, stored rows unchanged, enum value dropped later
  with consent).
- **Tab under «Ученики», no 12th sidebar item.** Recipients are students only; children via guardians.
- **Tiers:** route `COACHING_ROLES`; scope = the call-list rule (coach / direction manager: own groups);
  `RENEW`/`UNPAID`/«служебное» sport-lead only (the matrix's renewal and receivable tier); direct to any student
  in scope.
- **Channels:** in-app always; push + inbox via the existing producer; e-mail only when the club enables it
  (default off) and per message, trial allowance applies; **SMS later** (§13); Telegram stays dead.
- **«Открыли» = `readAt`** from opening the message, not inbox `seen`; «push» = a push row written.
- **Quiet hours 22:00–09:00 club time:** the whole delivery waits (simpler than a silent copy + delayed push;
  the preview names the time). «Срочно» for any sender, 2 per day, audited.
- **Opt-out:** `clubMessagesEnabled = false` or the club mute stop push/inbox for broadcasts; direct and service
  messages are exempt; the message stays in «Сообщения клуба» always; e-mail has its own one-click opt-out.
- **Legal (RU):** informational and service messages of the club (operator, 152-ФЗ) to its own members about
  their training and contract; the platform processes on instruction (DPA). Promotional content needs prior
  opt-in (38-ФЗ ст. 18) → not offered; compose hint + a lawyer question in `docs/legal/README.md`.
- **Segments at send time; limits** 10/club/day, 3/coach or manager/day, 50 direct/sender/day, 2 urgent, 3
  broadcast pushes/recipient/day. **No replies** (contacts instead). **Writing from «Кому позвонить» =
  «Связались».** **Dispatcher in the existing minute job.** **No MCP write tool.**
- **(implementation)** Member routes live at `workspaces/:workspaceId/me/messages[/:messageId[/read]]` (a second
  controller), not under `…/messages/me/…`, so they never collide with `messages/:messageId`.
- **(implementation)** The sport-lead branches (`RENEW`/`UNPAID`/`isService`) and the scope checks sit in
  `features/club-messages/compose.ts` (shared by preview and send); `route-tier-consistency.spec.ts` pins the
  tiers and the two `assertSportLead` calls there.
- **(implementation)** `UNPAID` = `studentWhere` ∩ `owesPaymentWhere` (the roster's «Должники» filter; students
  only, so staff owing for their own abonement are not messaged).
- **(implementation)** A scheduled message whose author is no longer staff of the club at send time is cancelled
  (its scope can't be re-derived); the author's scope is otherwise re-read at send.
- **(implementation)** Guardian settings apply to a child's copy (recipient gates landed with parent-pays): a
  broadcast to a child whose every guardian switched off «Сообщения клуба» or muted the club is recorded as
  `opted_out` / `muted`. The §14 «Guardian settings» risk is resolved.
- **(implementation)** Preview also returns `noDevice`, `capped`, `emailEnabled`, `timezone` and
  `limits.directLeft`; `limits.senderLeft` is null for sport leads. The member list returns `unreadCount`;
  `GET messages?userId=` items carry `recipientReadAt`.
- **(implementation)** Nobody who muted the club gets an e-mail copy of a broadcast — a muted guardian of a child
  included, while the other guardian still gets it; the e-mail opt-out (`clubMessagesEmailEnabled`) is per
  account, honoured for every kind. The unsubscribe link is `<userId>.<HMAC>` (HKDF of `ENCRYPTION_SECRET`).
  Opening it (GET) only checks it and shows a confirm page with a POST button — mail scanners open every link;
  only POST writes (the button, or the RFC 8058 one-click). Both answer HTML; a forged link gets a 400 page. The
  e-mail carries `List-Unsubscribe` + `List-Unsubscribe-Post`; its footer reads «Это письмо клуба «…»» (no
  sport word: the template has no club vocabulary).
- **(implementation)** `NotificationProducerService.filterOptedIn` stays private: delivery reads the
  `clubMessagesEnabled` opt-outs itself (`planPush`), the producer's recipient gates cover guardians.
- **(implementation)** Demo: the two stored «Только на продление» announcements (ACADEMY, Ритм) became
  `RENEW` messages; Ритм has three messages. Demo reset deletes the fixed accounts' `message.*` inbox rows of the
  club (they outlive the reset).
- **(implementation)** The dispatcher moves a due non-urgent message it holds for quiet hours to the next 09:00
  (`sendAt = nextSendAt(now, tz)`), so held messages leave the «due» window and never fill the 50-per-run batch
  ahead of messages due in other clubs.
- **(implementation)** Demo accounts get no e-mail at all: `SendEmailNotificationProcessor` drops a job whose
  recipient is `User.isDemo` (the row stays, `sent = false`, error «demo account: not e-mailed») — their
  `@academy.demo` / `@ritm.demo` addresses don't exist. Push needs no such rule (generated students have no
  devices; the fixed accounts on the presenter's phones should get pushes). So the generator no longer mutes every
  generated student (that made every preview read «отключили — 31»): 2–3 students per club stay muted for realism.
- **(implementation)** The «group of another club → 404» and «`MEMBERS` out of scope → 404» checks live in
  `compose.ts`, so they are covered by the send/preview handler specs; `segment-where.spec.ts` covers the pure
  where per segment × scope and `segments.spec.ts` the RENEW / CALL_LIST resolution.
- **(implementation, review)** Limits are counted under `pg_advisory_xact_lock(hashtext('club-messages:' ||
  workspaceId))` together with the insert (one transaction; delivery runs after the commit), and against the
  club-local day the message goes out on (`sendAt`), so a later day is limited on its own and the refusal names
  it («На 28 ноября у клуба уже 10 рассылок — выберите другой день»). «Срочно» with a future `sendAt` → 400.
  Delivery takes the same lock around the per-recipient cap read and the recipient rows.
- **(implementation, review)** `message.send` is audited right after the insert, before delivery, without a
  recipient count (the message row has it). `recipientCount`/`pushCount` are written in the recipients
  transaction; `emailCount`/`emailedAt` and the realtime notices in a `finally`, so a failing push or e-mail
  step never leaves the counters at 0.
- **(implementation, review)** A direct message written from «Кому позвонить» stores the logged contact's id
  (`ClubMessage.contactId`, additive column). Cancelling the message — by hand, or automatically because the
  author left — deletes that contact and drops the call-list cache, so the member is back on the list.
- **(implementation, admin)** Compose «Кому» is one select of the role's segments; a direction and groups are
  picked below it with `DirectionSelect` and the group chips (the building blocks of `AnnouncementTargetPicker`),
  not the picker itself — its own «Аудитория» select would be a second «Кому». A coach or direction manager is
  offered only own groups (`coaches` ∋ me, or a managed direction), mirroring `ownGroupsWhere`.
- **(implementation, admin)** A scheduled message is stopped with a «Отменить отправку» button in the panel's
  footer, not «⋯ → …» (a one-item overflow hides the only action). Below the sport leads the list holds only
  one's own messages, so whoever sees a scheduled one may cancel it. The confirm names the audience label
  (a scheduled message has no recipients until it goes).
- **(implementation, admin)** The day's limits are not retyped in the admin: the preview's `limits` disable
  «Отправить» with a generic «… на сегодня закончились» line, and the server's 400 wording shows inline on a send.
  «Срочно» is disabled when `urgentLeft = 0`; «Срочно» and «Отправить позже» exclude each other.
- **(implementation, admin)** «Отправить позже» is a `datetime-local` on the club clock (the preview's
  `timezone`, converted in `message-view.ts`); times in the list and the panel are formatted on the club clock.
- **(implementation, admin)** The e-mail switch sits in «Настройки → Уведомления → Ученикам», next to the
  birthday greetings (a club setting about students), not next to the personal digest switch. Compose shows
  «Также отправить на e-mail» from the preview's `emailEnabled` (coaches can't read settings).
- **(implementation, admin)** Roster: «⋯ → Написать этим ученикам (N)» appears for `inactive` (every coach) and
  `renew`/`unpaid` (sport leads), only without a search narrowing the list (the message goes to the segment).
  It opens `users/messages?compose=1&segment=…`. Retention lists open the panel in place.
- **(implementation, admin)** The member card's «Сообщения» block lists the last 5 messages the student got
  (each row opens it in `users/messages`); «Все» shows only past 5. The card's «⋯» is offered to every coach for
  a student (`roleName = user`), with «Написать сообщение» first.
- **(implementation, admin)** Admin e2e: the role matrix visits `users/messages?compose=1` for every role (the
  live preview fails the visit on a refused segment) and `…&segment=UNPAID` for the sport leads; the list itself is
  crawled from the tab row. No per-route «populated» check exists in the smoke suite, so none was added.
- **(implementation, mobile)** «Сообщения клуба» is a Profile-tab row (group «Клуб», after «События»; the
  sidebar shows it too), not a Home section: on a phone Home sections render only in the sidebar, and a message
  whose push was switched off must stay reachable. No app-section flag gates it.
- **(implementation, mobile)** An inbox row of a `message.*` kind opens `ClubMessage`; only that screen calls
  `markClubMessageRead` (the inbox's «mark all seen» stays «opened the inbox»). Without a `messageId` the row
  opens the list. A child's copy (`dependentId`) switches to the child's profile first, so the child's row is
  stamped; the detail screen then says «Профиль: Миша». The guardian's own list shows only the guardian's rows —
  a child's messages are listed in the child's profile, as every other per-person screen.
- **(implementation, mobile)** Staff compose is the fixed-audience quick path: one student (`MEMBERS`, from
  «Кому позвонить» with `logContact`, or the student's abonement header) or one group (`GROUPS`, from the class's
  attendance header). Other segments, «Отправить позже» and the history stay in the admin. The «Служебное»
  checkbox shows for sport leads, «Также отправить на e-mail» from the preview's `emailEnabled`. The
  abonement header icon shows when the screen's `permissions.canManage` is true (own groups for a coach, the
  same scope the server checks). «Написать» on «Кому позвонить» shows on open rows only (`logContact` needs one).
- **(implementation, mobile)** «Сообщения клуба на e-mail» shows for an account with an e-mail, regardless of
  the club switch (the preference is per person across clubs). Both switches are hidden in a child's profile
  like every notification switch: the guardian's settings govern a child's copies.

## 12. Implementation slices

One PR, three parallel slices. S1 commits the schema, DTOs and controllers first, with the contract
regenerated. S2 and S3 code against the generated types. No one runs the full gate mid-flight; the integrator
runs it once.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server | `apps/server/prisma/schema.prisma`; `apps/server/src/domains/messages/**` (+specs); `domains/notifications/quiet-hours.ts` (+spec; first of the two designs to land creates it); `features/club-messages/**` (features, handlers, controller, `schemas.ts`, specs); `features/public-unsubscribe/**` (new); `app/app.module.ts`; `domains/notifications/notification-mute.ts` (+spec); `domains/notifications/services/notification-producer.service.ts` (`filterOptedIn` public, +spec); `domains/notifications/services/preferences.service.ts` (category key); `features/notification-preferences/**` (two fields); `features/update-workspace-settings/**` (`messagesEmailEnabled`); `domains/scheduler/reminders.service.ts` (+spec); `features/manage-announcements/{create,update}-announcement.feature.ts`, `schemas.ts` (+spec); `domains/audit/services/audit.service.ts` (actions); `domains/billing/services/trial-limits.service.ts` only if a batch helper is needed; e-mail template seed for `club-message`; `features/mcp/tools/club-tools.ts` (+spec); `apps/server-e2e/src/messages/**`; `open-api.json`, `libs/api-client/src/openapi/*` | 3.5 d |
| S2 admin | `apps/admin/src/features/messages/**` (page, sheets, view helpers, specs); `app/(dashboard)/workspace/[workspaceId]/users/messages/page.tsx` (new); `…/sections.ts`; `…/users/page.tsx`; `…/users/[userId]/page.tsx`; `…/retention/{call-list,renew-list}.tsx` (+spec); `features/announcements/AnnouncementFormSheet.tsx`; `features/notifications/` (e-mail toggle); `…/settings/notifications/page.tsx`; `features/audit/audit-meta.ts`; `shared/api/messages.ts` (new), `shared/api/settings.ts`; `shared/lib/contract-limits.ts` (+spec); `apps/admin-e2e/src/role-matrix.ts` | 2.5 d |
| S3 mobile + demo + docs | `apps/mobile/src/features/messages/**` (new screens, helpers, specs); `app/navigation.ts`, `app/App.tsx`, `app/nav-sections.ts`; `features/notifications/notification-route.ts` (+spec); `features/profile/SettingsScreen.tsx`; `features/retention/AtRiskMemberCard.tsx`; the `SessionAttendance` and `MemberSubscription` screen headers; `shared/api/messages.ts` (new); `apps/server/src/domains/demo/{demo-club.plan,ritm-demo.plan,demo-club.writer}.ts` (+specs); `docs/demo.md`, `docs/mcp.md`, `docs/legal/README.md` (lawyer question), `CHANGELOG.md`; the glossary row in `docs/design/2026-11-08-admin-cleanup.md` | 2 d |

Interface: §3 (models), §4.2 (routes, DTO names), realtime keys `messages` / `club-messages`, notification
kinds `message.broadcast|service|direct`, preference keys `clubMessagesEnabled|clubMessagesEmailEnabled`.

Integrator checks: tsc server / admin / mobile; `npx nx test @clubspace/server -- messages` (+ `club-messages`,
`notification-mute`, `reminders`, `announcements`, `route-tier-consistency`, `club-tools`, `demo`); admin and
mobile units; server e2e `messages/*`; contract drift; `npm run test:admin-e2e`; `cs-reviewer` before merge.

## 13. Next steps (not in this PR), with sketches

- **SMS:** adapter `domains/notifications/sms/` (SMS.RU / SMSC / МТС Exolve), `SMS` on `NotificationTypeEnum`,
  `smsCount`; paid per message → a platform module with a package or the club's own key (encrypted like payment
  keys); registered sender name; service SMS need no ad consent, promotional need opt-in. Main use: «Также SMS
  тем, у кого нет приложения» (`pushSkip = 'no_device'`).
- **Replies / chat:** `ClubMessageReply` per recipient, staff «Ответы» on «Ученики → Сообщения», `message.reply`
  to the author, moderation, retention agreed with the lawyer.
- **Marketing channel:** consent kind `MARKETING` (opt-in), «Новости и акции» toggle off by default, a
  «рекламное» flag delivered only to opted-in members.
- **Automations** (renewal after N days, birthday — E9, first-visit welcome) as scheduler-made `ClubMessage`s;
  **templates** per club.

## 14. Open risks

- **Push written ≠ delivered:** Expo tickets can fail later (`push-delivery.service.ts:344-360`); the panel says
  «push отправлен», not «доставлен».
- **Segment drift:** a scheduled message's final count can differ from the preview; the panel shows the real one.
- **Inline latency:** a 1 500-recipient `ALL` adds ~1–2 s [INFERENCE: one `createMany` per 500 + one producer
  batch]; if noticeable, route all sends through the dispatcher (next minute).
- **Guardian settings:** a child's opt-out is the child's preferences row; guardians' settings don't apply to
  children's notices yet (`docs/strategy/concept.md:155-156`). Unchanged.
- **«Service» vs «promotional»** is a lawyer question (`docs/legal/README.md`); the product refuses no text — the
  hint, the limits and the audit (club admins see every message) are the controls.
