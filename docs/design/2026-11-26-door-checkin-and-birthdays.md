# Door check-in by member card QR; birthday greetings (backlog E9)

Status: **design** · 2026-11-26 · base: `main` @ `d434461c` (plus uncommitted demo-readiness fixes)
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E9 («QR check-in at the door; birthday greetings»,
`2026-11-08-admin-cleanup.md:1031`; the waiver/contract part of E9 is not in this doc). Siblings:
[attendance check-in](2026-07-02-attendance-checkin-design.md) («no QR in v1», `:31,306`),
[requests inbox](2026-11-15-requests-inbox.md). File:line references are as of `d434461c`. The owner was
asleep; every choice is in §10 «Decisions» and may be overruled.

## Кратко (для владельца)

**Вход по QR.** Сейчас ученик может отметиться только 6-значным кодом, который тренер называет группе.
Мы выбрали самый простой и надёжный вариант QR. У каждого ученика в приложении есть **«Моя карта»** с
QR-кодом. Тренер в отметке занятия нажимает «Сканировать» и наводит телефон на карту. На экране
появляется фото и имя ученика, и отметка ставится сразу. Абонемент списывается ровно так же, как при
касании имени в списке. Есть кнопка «Отменить» на 5 секунд.

Почему не QR на стене зала: такой постер можно сфотографировать и «отмечаться» из дома, а защита от
этого требует геолокации и лишних разрешений. Карту сканирует тренер, который видит человека. Новых прав
это не даёт: тренер и так может отметить любого.

- **Карта работает без интернета у ученика.** Она сохраняется в телефоне после первого открытия.
- **Если у тренера пропала связь,** отсканированные карты ждут и отправляются, когда связь вернётся.
- **Детям** карту показывает родитель в профиле ребёнка. Администратор может распечатать карту ребёнку
  из карточки ученика: «⋯ → Карта для входа».
- **Код самоотметки остаётся** как есть.

**Дни рождения.**
- Ученик может указать дату рождения в профиле приложения. Сотрудник может указать её в карточке
  ученика. У детей дату уже вводит родитель.
- Дату рождения видят только сотрудники клуба (и сам человек или его родитель).
- В день рождения, в 10:00 по времени клуба, ученик получает поздравление от клуба. Поздравление ребёнку
  приходит родителям: «Аня: С днём рождения!».
- На «Сегодня» появляется блок «Дни рождения сегодня», только если в этот день есть именинники. Тренер
  видит именинников своих групп.
- Клуб может выключить поздравления в «Настройки → Уведомления». По умолчанию они включены.
- Текст поздравления без рекламы и скидок: иначе это реклама, и на неё нужно отдельное согласие.

## Problem

1. **Check-in has one self-service path, a spoken 6-character code.**
   - The code is generated per session when the coach opens attendance (`create-session.handler.ts:85-89`,
     `attendance-utils.ts:8-14`).
   - It is shown only on the coach's roster («Код самоотметки — назовите его группе»,
     `SessionAttendanceScreen.tsx:447-452`).
   - The member types it on `CheckInScreen.tsx`; it matches a session within ±12 h
     (`self-check-in-session.ts:18-20,46-55`).

   At the door of a 30-person class the coach either reads the code out or searches names one by one.
   There is no QR anywhere in attendance. The app already has a camera QR scanner, but only for club
   join posters (`apps/mobile/src/features/join/ScanJoinQrScreen.tsx:2,76-79`, `expo-camera` in
   `apps/mobile/package.json:26`).
2. **Birthdays have a declared event and no source.** `UsersEventPattern.USER_BIRTHDAY_APPROACHING`
   and its payload (`users-events.config.ts:30,44-48`) have no publisher and no listener.
   `User.dateOfBirth` exists (`schema.prisma`, model `User`) but is set only for children
   (`add-my-dependent.handler.ts:71`, `add-workspace-dependent.handler.ts:130`), by CSV import
   (`club-import.engine.ts:1080`) and by the demo.
   - An adult can't enter it: `UpdateMeInputSchema` has names only (`update-me.feature.ts`).
   - Staff can't either: `UpdateMemberProfileFeatureInputSchema` has names, e-mail and phone
     (`update-member-profile.feature.ts:4-9`).
   - The member card doesn't show it (`users/[userId]/page.tsx:524-556`).
3. **Nothing greets anyone.** The daily club pass runs at club-local 10–11 with a per-club-day claim
   (`daily-club.service.ts:25,67-68`). It sends inactivity and access-expiry notices only.

## Goal / non-goals

Goals:
- A member shows a personal QR card; staff scan it from the session roster and the visit is marked
  through the existing mark path (same abonement deduction, bookings, follow-ups, undo).
- The card works with no connection on the member's phone. The coach's scans survive a dropped
  connection.
- Date of birth is editable by the member, the guardian (already) and sport leads, and readable only by
  staff, the person and their guardian.
- A daily greeting at 10:00 club-local, child greetings via guardians. A «Дни рождения сегодня» block on
  «Сегодня» when non-empty, scoped like the roster.

Non-goals:
- A club wall/poster QR that members scan, a kiosk/tablet mode, geofencing.
- A reception «Вход в зал» mode that picks the class by gym without opening a session. The coach or
  admin opens the class from «Сегодня» / «Сегодня вы ведёте».
- Rotating card codes, per-card revocation, NFC, wallet passes.
- Turnstile/access-control hardware.
- Birthday discounts or promo codes in the greeting, SMS/e-mail greetings, greeting staff.
- Showing birthdays to other members (leaderboards, group lists): never.
- Waivers and contracts for minors (the rest of E9): a separate design.

## 1. The check-in rules

- **What the QR carries:** `CS1.<userId>.<mac>`. `mac` is the first 16 base64url characters of
  `HMAC-SHA256(key, "CS1." + userId)`, with `key = HKDF-SHA256(ENCRYPTION_SECRET, salt "clubspace",
  info "check-in-card/v1", 32 bytes)`.
  - The card is per person, not per club: one card for every club the person belongs to.
  - It is static, so it can be cached and shown offline.
  - Plain text, not a URL: a phone camera shows a meaningless string.
- **Who scans:** anyone who may mark the session (`loadSessionForWrite` → `assertCanMarkClass`): the
  group's coaches, sport leads and approved substitutes, and every coach when `coachesMarkAnyClass` is on.
  This is the same set as tapping a name.
- **What a scan does:**
  1. `card-lookup` verifies the MAC (timing-safe) and resolves the person in this club.
  2. The app immediately calls the existing `POST attendance/sessions/:sessionId/records` with
     `userIds: [id]`.
  3. The roster row in the answer gives «Списано: … · осталось N».

  So deduction is exactly mark-records: precedence, packs with the guarded decrement, frozen abonements
  allowed (coach marking), «с первой тренировки» start, bookings «пришёл», pack alerts, achievements,
  `lastAttendedAt`, leaderboard. «Отменить» (5 s) calls the existing unmark, which refunds the exact pack.
- **Refusals:**
  - not a ClubSpace card / bad MAC → 400 «Это не карта участника ClubSpace»;
  - no membership in this club (and not the owner) → 404 «Этого человека нет в клубе»; no name is leaked
    across clubs;
  - membership not ACTIVE → 400 «{Имя} не активен в клубе — отметить нельзя» (mark-records would refuse
    anyway);
  - already marked → 200 with `alreadyMarked: true`, and the app shows «Уже отмечен» without a second
    call.
- **Lateness:** no server window, same as coach marking today. The «Сканировать» button is shown from
  60 min before start to 4 h after; outside that the coach taps names. A late member is scanned like any
  other: lateness is the coach's call.
- **Offline (coach):** a scan whose lookup fails on the network is queued per session on the device
  (`scan-queue:<sessionId>`, raw card strings, deduplicated). The queue is drained on screen focus and by
  «Отправить (N)». A queued item that later fails shows its error in the list. Nothing is marked
  locally; the server decides.
- **Offline (member):** the app caches `{ card, qrPngDataUrl }` per user id after the first successful
  read and shows it with no connection.

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
model Workspace {
  // …
  // «Поздравлять учеников с днём рождения»: the daily pass greets members at
  // club-local 10:00 (docs/design/…door-checkin-and-birthdays.md).
  birthdayGreetingsEnabled Boolean @default(true)
}
```

The card needs no table: it is derived from the user id and the server secret. `User.dateOfBirth`
already exists. There is no backfill and no `deploy/update.sh` step. Dead code removed:
`USER_BIRTHDAY_APPROACHING` and its payload type in `users-events.config.ts` (no references besides the
declaration).

## 3. Server

### 3.1 Check-in card — `features/check-in-card/`

- `check-in-card-utils.ts` (pure, unit-tested): `signCheckInCard(userId, secret)`,
  `verifyCheckInCard(card, secret): string | null` (user id or null; strict format; `timingSafeEqual`).
  The key is derived once from `environment.encryptionKey`.
- `check-in-card-qr.ts`: `buildCheckInCardPngDataUrl(card)` → `toDataURL(card, { errorCorrectionLevel: 'M',
  margin: 2, width: 768 })`. It sits in its own file so specs can mock it, like `domains/workspace/join-qr.ts`.
- `get-my-check-in-card.feature.ts` / `.handler.ts`: `GetMyCheckInCardFeature(workspaceId, userId)`. It
  requires a member row (or owner), so the card is for members. Works under `X-Act-As` (workspace route):
  the child's card.
- `get-member-check-in-card.feature.ts` / `.handler.ts`: `GetMemberCheckInCardFeature(workspaceId,
  targetUserId, invokerUserId, roleName, isSuperAdmin)`. `assertSportLead`; target must be a member;
  `assertCanManageRoles` refuses a staff target for a head coach (the same rule as profile edits). It is
  for printing a child's card.
- `lookup-check-in-card.feature.ts` / `.handler.ts`: `LookupCheckInCardFeature(payload, workspaceId,
  sessionId, invokerUserId, roleName, isSuperAdmin)`. It calls `resolveCoachScope`, then
  `loadSessionForWrite`, then the rules of §1. It doesn't write.
- `schemas.ts`: `CheckInCardSchema = { card, qrPngDataUrl, name }`;
  `CheckInCardLookupSchema = { userId, name, photoUrl: string|null, isDependent, inGroup: boolean|null,
  alreadyMarked }`.
- `check-in-card.controller.ts`, `@Controller('workspaces/:workspaceId')`, guards
  `AuthGuard, WorkspaceMemberGuard, RoleGuard`:

| Method | Route | Tier | DTOs |
|---|---|---|---|
| `getMyCheckInCard` | `GET me/check-in-card` | any member (no `@Roles`), act-as | out `MyCheckInCardOutput` |
| `getMemberCheckInCard` | `GET members/:userId/check-in-card` | `SPORT_LEADS` | out `MemberCheckInCardOutput` |
| `lookupCheckInCard` | `POST attendance/sessions/:sessionId/card-lookup` | `COACHING_ROLES`, `@Throttle` 120/min | in `LookupCheckInCardInput { card: string ≤ 120 }`, out `LookupCheckInCardOutput` |

- No `@AllowExpiredAccess()` on `getMyCheckInCard`: a member whose access ran out can't train. The coach
  can still mark them from the roster, as today.
- Audit: none new. The mark is audited and attributed as today (`markedById` = the scanning coach).
- Realtime: none new; mark-records emits `attendance` / `subscription` as today.
- Registration in `app/app.module.ts`.

### 3.2 Date of birth on profiles

- `update-me.feature.ts`: `dateOfBirth: dateOfBirthSchema.nullable().optional()` (from
  `features/dependents/dependents-utils.ts:15-22`); the handler stores it with `dateOfBirthToDate`.
  `get-me/schemas.ts` `MeOutputSchema` gains `dateOfBirth: z.iso.date().nullable().optional()`. Under
  act-as `/me` is the child, so the parent sees the child's date, which they entered.
- `update-member-profile.feature.ts:4-17`: input and output gain `dateOfBirth`. Tier unchanged
  (`SPORT_LEADS`, `assertCanManageRoles` for staff targets). The audit `member.updateProfile` already
  records `changes: payload` (`update-member-profile.handler.ts:213-222`); it then includes the date,
  which club admins may see.
- `get-member-progress` (`STAFF_ROLES`): the member block gains `dateOfBirth: z.iso.date().nullable()`.
- **Never** added to: member-facing group lists, leaderboard, public profile, MCP/AI tools (§6), CSV
  exports. `export-my-data` already includes it for the person (`export-my-data.handler.ts:369`).

### 3.3 Greetings — `domains/birthdays/birthdays.ts` + daily pass

- `isBirthdayOn(dob: Date, ymd: string): boolean`: the month-day of `dob` (UTC, as stored) equals `ymd`'s.
  A 29 February birthday matches 28 February in non-leap years.
- `birthdayGreeting(club: { name: string; type: string })` → `{ topic: 'С днём рождения!', message:
  'Клуб «{name}» поздравляет с днём рождения! Здоровья, сил и радости от {session.genPl}.' }`. Club
  vocabulary via `vocabularyForWorkspaceType`. There is no «вас»: the same text reads right for an adult
  and for a parent getting «Аня: С днём рождения!».
- `loadBirthdayMembers(prisma, { workspaceId, ymd, userIds? })`: ACTIVE `WorkspaceMember`s with role
  `user`, `user.status = ACTIVE`, `user.dateOfBirth != null`, filtered by `isBirthdayOn`. Clubs are ≤ 400
  members, so filtering in JS is fine. It also serves the staff list.
- `domains/scheduler/daily-club.service.ts`: a third step `greetBirthdays(club, now)` after the two
  existing ones, when `club.birthdayGreetingsEnabled` (`clubs-due.ts` adds the field to `DueClub` and its
  select).
  - Dedupe per person and year: kind `member.birthday`, refId `${club.id}:${userId}:${yyyy}`
    (`claimUnsent`).
  - Rows go through `writeMany` with `metadata: { kind: 'member.birthday', workspaceId }`.
  - `run()`'s summary gains `birthdaysGreeted`.
  - The kind is **not** mute-exempt (club chatter) and has no category: a member who doesn't want it mutes
    the club or clears the date.
  - Dependents are routed to confirmed guardians by `writeMany` as every notice is.
- Time: `DAILY_CLUB_LOCAL_HOURS = [10, 11]` already gives «10:00 club-local, 11:00 retry».

### 3.4 «Дни рождения сегодня» — `features/birthdays/`

- `list-birthdays-today.feature.ts` / `.handler.ts` / `.controller.ts`, `schemas.ts`.
- `GET workspaces/:workspaceId/birthdays/today`, method `listBirthdaysToday`, `@Roles(STAFF_ROLES)`,
  output `ListBirthdaysTodayOutput = { date: 'YYYY-MM-DD', members: BirthdayMember[] }`.
- `BirthdayMember = { userId, name, photoUrl, isDependent, turns: number | null, groups: { id, name }[] }`.
  `turns` is set only for children (`isDependent`): coaches of kids' groups congratulate in class, and
  adults' ages stay off the screen.
- The handler: `resolveCoachScope`; the date is club-local today (`localDateInTz(now, workspace.timezone)`);
  `loadBirthdayMembers`. When `!canSeeAllGroups(ctx)`, limited to `rbac.ownGroupMemberIds(ctx)` (the
  roster rule, `list-workspace-members.handler.ts:122-129`). Sorted by name.
- Settings: `update-workspace-settings.feature.ts` input `birthdayGreetingsEnabled: z.boolean().optional()`,
  output field; `get-workspace-settings` output field. Tier and audit unchanged
  (`workspace.updateSettings`, `CLUB_ADMINS`).

## 4. Admin UI

- **«Сегодня»** (`app/…/workspace/[workspaceId]/page.tsx`): a self-contained
  `features/dashboard/BirthdaysToday.tsx` (own fetch via `shared/api/birthdays.ts`, ttl 0, reload on the
  `members` realtime key).
  - It renders below the decisions/classes grid and only when `members.length > 0`; nothing at all
    otherwise, so the page's «ничего не ждёт решения» text is unchanged.
  - Title «Дни рождения сегодня». Rows: avatar, name, «исполняется N» for a child, groups in muted text.
  - The row opens the member card. No buttons, no «⋯».
  - It is not a decision row: nothing waits for a decision, and `DECISION_KEYS` stays as is.
- **Member card** (`users/[userId]/page.tsx:524-556`):
  - the profile list gains «Дата рождения» → «4 мая 2016 (10 лет)» or «не указана»;
  - `features/users/ProfileEditForm.tsx` gains a date input (native `type="date"`, max = today), sent as
    `dateOfBirth` (empty → null);
  - the existing «⋯» menu (`:362-385`) gains «Карта для входа» for sport leads. It opens a side panel
    `features/users/CheckInCardSheet.tsx` with the QR image (`qrPngDataUrl`), the name, the hint «Покажите
    эту карту {coach.dat} у входа» and one primary «Распечатать» (`window.print()` with a print stylesheet
    limited to the card).
- **«Настройки → Уведомления»** (`settings/notifications/page.tsx`): a second card «Ученикам» with
  `features/notifications/BirthdayGreetingsToggle.tsx`: «Поздравлять с днём рождения — в 10:00 по времени
  клуба, ребёнку — через родителей». It is a `SettingSwitch` (`features/settings/SettingSwitch.tsx`)
  saved immediately through `useWorkspaceSettings().save` (`use-workspace-settings.ts:53-63`, which sends
  `expectedUpdatedAt`), the pattern of the other settings switches; on 409 → its `stale` notice.
- No new routes or sidebar items. `apps/admin-e2e/src/role-matrix.ts` is unchanged.

## 5. Mobile

**Member (and parent in a child's profile):**
- `features/attendance/CheckInScreen.tsx`:
  - the top block is «Моя карта»: the QR (`Image` from `qrPngDataUrl`, ~240 pt, white plate), the name,
    and «Покажите {coach.dat} у входа»;
  - below it, the existing code field under «Или введите код занятия».
  - The card comes from `shared/check-in-card-store.ts` (AsyncStorage, key `check-in-card:<userId>`):
    shown at once from the cache, refreshed from `getMyCheckInCard` in the background; with no cache and
    no network, «Карта появится, когда будет интернет».
  - The Home entry point (`HomeScreen.tsx:377`) is unchanged.
- `shared/api/check-in-card.ts`: `getMyCheckInCard`, `lookupCheckInCard`. The workspace routes are already
  act-as allowlisted (`act-as.ts:35`), so in a child's profile the child's card shows.
- `features/profile/EditNameModal.tsx` → «Профиль»: an optional «Дата рождения» field (reuse
  `parseBirthDate` / `formatBirthDate` from `features/children/`), hint «Видят только сотрудники клуба.
  Клуб поздравит вас с днём рождения.» Saved via `updateMe`.

**Coach:**
- `features/attendance/SessionAttendanceScreen.tsx`: one secondary «Сканировать» button next to the
  code block (`:447-452`), within the 60 min / 4 h window. It opens `features/attendance/ScanCardSheet.tsx`
  (full-height camera sheet reusing `CameraView` with `barcodeTypes: ["qr"]` and the permission handling of
  `ScanJoinQrScreen` / `qr-scanner.ts`).
  - It scans continuously, with a 2 s debounce per card string.
  - Each hit shows a result strip: photo, name, «Отмечен · списано: БЖЖ 12, осталось 7», «Уже отмечен» or
    the refusal text, plus «Отменить» for 5 s.
  - The roster refreshes on close and on the `attendance` signal as today.
- `features/attendance/scan-queue.ts` (pure, +spec): `enqueue`, `dedupe`, `drain(lookupAndMark)`.
  Persistence is `scan-queue:<sessionId>`. The sheet shows «Не отправлено: N · Отправить».
- `features/home/HomeScreen.tsx`: for staff, one compact card «Дни рождения сегодня: Аня С., Пётр К.» under
  «Сегодня вы ведёте», only when non-empty (`shared/api/birthdays.ts`). The row opens the member's progress
  screen as the roster does.

## 6. MCP / AI

No tool exposes the date of birth (`features/mcp/tools/member-tools.ts` `member_profile` unchanged), and
no birthday tool is added. The ИИ-ассистент sends tool output to an external model, and a birth date
adds personal data without a use. The card is never exposed to tools.

## 7. Demo generator

- `domains/demo/demo-club.plan.ts`:
  - Аня (the parent account's daughter, `:745-754`) gets `dob = today − 7 years` (same month-day as
    generation day), so after every reset she has a birthday «today».
  - Two non-fixed members get today's month-day too (one adult, one kid in another group), so «Сегодня»
    shows three rows and a coach sees their own.
  - No pre-written greeting: the plan and writer don't write notifications today
    (`demo-club.plan.ts`/`demo-club.writer.ts` have no notification rows). The real 10:00 pass sends
    «Аня: С днём рождения!» to the parent account when the demo is reset before 10:00 club-local.
- `ritm-demo.plan.ts`: one adult member with today's month-day.
- The demo club keeps `birthdayGreetingsEnabled` = true (default).
- The card needs no demo data: every demo account gets its card from the server secret.
- `docs/demo.md`: the student phone «Отметиться → Моя карта», the coach phone «Отметить → Сканировать»
  (scan the student phone), and the owner «Сегодня → Дни рождения сегодня». It notes that the parent's
  greeting arrives at 10:00 club-local after a morning reset.

## 8. Tests

Unit (server):
- `check-in-card-utils.spec.ts`: sign/verify round trip; wrong MAC, wrong prefix, malformed uuid, extra
  segments → null; the MAC differs per user; constant format length.
- `lookup-check-in-card.handler.spec.ts`:
  - a coach of another group without `coachesMarkAnyClass` → 403 (via `loadSessionForWrite`);
  - a student role → 403;
  - owner bypass;
  - unknown session → 404;
  - bad card → 400;
  - non-member → 404 without a name;
  - BLOCKED member → 400 with the name;
  - already marked → `alreadyMarked: true`;
  - the owner as the scanned person → resolves;
  - a guest (not in the group) → `inGroup: false`.
- `get-member-check-in-card.handler.spec.ts`: coach → 403; head coach on a staff target → 403;
  non-member → 404; happy path.
- `get-my-check-in-card.handler.spec.ts`: a non-member → 404; owner; member.
- `birthdays.spec.ts`: `isBirthdayOn` incl. 29 Feb in leap and non-leap years, club-local date
  boundaries; `birthdayGreeting` vocabulary.
- `daily-club.service.spec.ts`: greets once per year (claim), skips when the club setting is off, skips
  non-ACTIVE, staff and users without a date, a child row goes through `writeMany` (routing covered by
  producer specs).
- `list-birthdays-today.handler.spec.ts`: a coach sees only own groups' members; a lead sees all; `turns`
  only for children; a student role → 403; empty list.
- `update-me.handler.spec.ts`, `update-member-profile.handler.spec.ts`: a date set, cleared, a future date
  → 400; head coach on a staff target → 403 (existing gate).
- `route-tier-consistency` (new controller tiers), `workspace-id-source`.

Server e2e:
- `apps/server-e2e/src/attendance/check-in-card.e2e-spec.ts`:
  1. a student reads their card;
  2. the coach opens a session, `card-lookup` → `alreadyMarked: false`;
  3. `records` → the 8-class pack drops to 7;
  4. a second lookup → `alreadyMarked: true`;
  5. unmark → back to 8.

  Also: a card from another club's member → 404; a forged card → 400; a parent reads the child's card
  under `X-Act-As`.
- `apps/server-e2e/src/birthdays/birthdays.e2e-spec.ts`:
  - a member sets a date via `PATCH /me`; another student can't see it in any member-facing read
    (group members, leaderboard);
  - staff see it in member progress;
  - `GET birthdays/today` lists today's person, a coach sees only their group;
  - running `DailyClubService.run` at 10:00 club-local writes one greeting, a child's to both
    guardians, and a second run writes none.

Admin: `BirthdaysToday` render spec (hidden when empty), `ProfileEditForm.spec.tsx` (date field),
`CheckInCardSheet` render spec. Mobile: `scan-queue.spec.ts`, a `check-in-card-store` spec. Admin e2e
matrix: no change (no routes).

## 9. Acceptance checklist

- [ ] Student phone: «Отметиться» shows «Моя карта» with a QR, also in airplane mode after one online open.
- [ ] Coach phone: «Отметить» → «Сканировать» → the student's card → photo, name, «Отмечен · списано …»;
      the roster shows the mark; «Отменить» returns the class.
- [ ] A frozen abonement: the scan marks (as tapping does), the self-check-in code still refuses.
- [ ] A card from someone outside the club → «Этого человека нет в клубе», no name.
- [ ] Coach offline: scans queue, «Отправить (N)» marks them when online.
- [ ] Parent: child's profile → «Моя карта» shows the child's card. Admin «⋯ → Карта для входа» prints it.
- [ ] A member sets a birth date in the app; staff see it in the card; another student never sees it.
- [ ] At 10:00 club-local a member with a birthday gets «С днём рождения!»; a child's goes to the parents
      as «Аня: С днём рождения!»; no duplicate at 11:00.
- [ ] «Сегодня» shows «Дни рождения сегодня» only when someone has a birthday; a coach sees their groups only.
- [ ] «Настройки → Уведомления» switch off → no greetings the next day.
- [ ] tsc server / admin / mobile clean; contract regenerated; listed tests green.

## 10. Decisions

- **The coach scans the member's card; no club wall QR.** A static poster can be photographed and used
  from home. Fixing that needs geolocation (permission, 152-ФЗ, flaky indoors) or a rotating screen at
  the door (hardware the small clubs don't have). With a card, a person who may already mark the class
  is present and sees the face. No new privilege, nothing for the member to abuse.
- **Two calls, existing write.** `card-lookup` only resolves; marking is the existing `records`
  endpoint. Deduction, races (`createManyAndReturn` + unique), refunds on unmark and follow-ups stay in
  one tested place. No refactor of the hot mark path.
- **Static HMAC card, no table.** It works offline and needs no migration. The MAC proves the phone shows a
  real ClubSpace card, not a typed id. Revocation is by key version (`CS2`) only; per-card revocation isn't
  needed while staff see the photo and name.
- **The key is derived from `ENCRYPTION_SECRET` (HKDF), not a new env.** That's one less deploy step.
  Rotating that secret also rotates cards; the app re-fetches on the next online open.
- **Per person, not per club.** A person in two clubs has one card; the lookup resolves only members of
  the scanning club.
- **No server lateness window,** like coach marking. The button's visibility window is UI only.
- **The 6-character self check-in code stays** as the self-service path.
- **Kids:** card in the child's profile on the parent's phone, or printed by a sport lead.
- **Date of birth: `User.dateOfBirth`, global.** It's the person's data, set by the person, the guardian or
  a sport lead. The consent and privacy texts already list «дата рождения»
  (`apps/client/src/app/legal/consent/page.tsx:75`, `privacy/page.tsx:58`). Visible only to staff, self and
  guardian.
- **Greet ACTIVE members with role `user` only.** Not staff: a push «from the club» to its own coach reads
  oddly, and staff aren't on the list either.
- **Club switch, default on.** One switch in «Настройки → Уведомления». No per-user category: club mute or
  clearing the date covers the rare objector, and the toggle list stays short.
- **Greeting text: fixed, no offers** (38-ФЗ «О рекламе»: an offer would need advertising consent). No
  «вас», so it reads right when routed to a parent.
- **One greeting per person per year per club.** A person in two clubs gets two greetings, one from each
  club, and each club's mute applies.
- **«Дни рождения сегодня» is a block, not a decision row.** It's shown only when non-empty, opens the
  member card, and the age is shown for children only.
- **No birth date in MCP/AI tools.**
- **`USER_BIRTHDAY_APPROACHING` is deleted:** dead declaration; the daily pass is the source.
- (implementation) **The member card is cached in the resource cache, not AsyncStorage.** The app has no
  AsyncStorage; `shared/check-in-card-store.ts` keys `check-in-card:<userId>` in the existing per-profile
  resource cache (file on native, localStorage on the web, wiped on sign-out). The person comes from the
  cached `me:<club>` (Home's key), so the card opens offline; a cached card of another person is never shown.
- (implementation) **The code field on «Отметиться» no longer auto-focuses**: the keyboard would cover the card,
  which is now the main way in.
- (implementation) **The scan queue lives in the same resource cache** (`scan-queue:<sessionId>`); it is drained on
  focus, when the queue is read and when the connection returns, besides «Отправить». A card refused when sent stays
  listed with the server's reason until «Понятно». A QR that is not a `CS1.` card is refused on the phone with the
  server's own words and never queued. «Сканировать» is hidden for a personal session (one member: a tap).
- (implementation) **The coach's Home birthday card is read-only**: the app has no member screen to open (the roster
  opens only the abonement card). Names as «Аня С.».
- (implementation) **The birth date in the app is in «Профиль» only** (`EditNameModal withBirthDate`); the name
  prompts on Home/join stay name-only. Hint «Клуб сможет поздравить…», not «поздравит»: the club may switch it off.
  Only a changed date is sent, so the audit names real changes. The admin form also sends the date only when changed.
- (implementation) **«Карта для входа» prints through a self-contained page** (the club poster's pattern,
  `check-in-card-print.ts`), not `window.print()` of the dashboard: no print stylesheet to keep in sync with the
  layout and the sheet portal. The menu item sits in the existing «⋯» (sport leads, staff rows club admins only).
- (implementation) **«Дни рождения сегодня» hides on a failed read** as on an empty day (a bonus block, like the
  page's other best-effort rows). Age as «исполняется 7 лет».
- (implementation) Admin: `FORM_LIMITS.profile` (names, e-mail, phone from the contract) feeds `ProfileEditForm`'s
  `maxLength`; audit labels: «дата рождения» (shown as ДД.ММ.ГГГГ), «поздравления с днём рождения»,
  `member.updateOwnProfile` → «Участник изменил свой профиль».
- **(implementation) «Дни рождения сегодня»: every coach sees only their own groups' students**, also in a
  club with «тренеры видят все группы» (`!canWriteAllGroups`, not §3.4's `!canSeeAllGroups`). It matches
  «Тренер видит именинников своих групп» above: the block is «whom to congratulate in my class», and a coach
  who reads every group can still open any member card. The groups named on a coach's row are only theirs.
- **(implementation) `card-lookup` answers 200** (`@HttpCode(OK)`: it reads, creates nothing) and the
  `:sessionId` / `:userId` params of the card routes go through `ParseUUIDPipe` (a malformed id is a 400,
  not a Prisma error).
- **(implementation) Names:** the card face and the lookup use the roster's `displayName` (name, else the
  e-mail for an adult, else «Участник»), the same text the coach sees in the roster.
- **(implementation) The owner as a card target** of `getMemberCheckInCard` counts as staff (`admin`) for
  `assertCanManageRoles`, like profile edits; `getMyCheckInCard` without a member row is a 404 unless the
  caller owns the club (a super admin gets no card).
- **(implementation) The `member.updateOwnProfile` audit keeps the date as sent** (`YYYY-MM-DD`), not the
  stored timestamp.
- **(implementation) Demo generator is in the server slice** (the assignment moved it from S3). Аня turns 7
  on reset day; the other two are the first regular single-group adult of «ММА Взрослые» (Белая рысь,
  outside the БЖЖ direction manager's groups) and the first regular kid of «Юпитер» juniors, so the owner
  sees three rows and the БЖЖ direction manager two. Anyone else whose random date falls on reset day is
  moved a week earlier, so the list is the same on every reset. On 29 February the leap year at or before
  is used (`birthdateTurningOn`). «Ритм»: the first regular adult.
- **(implementation) «No birth date in AI tools» is pinned on the source:** `features/mcp/no-birth-date-source.spec.ts`
  fails if `features/mcp`, `features/ai-chat` or `domains/ai-assistant` mention `dateOfBirth` or the check-in card.

## 11. Implementation slices

One PR, three parallel slices. S1 lands the schema field, DTOs and controllers first and regenerates the
contract; S2 and S3 code against those types. Nobody runs the full gate mid-flight.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server | `apps/server/prisma/schema.prisma` (`Workspace.birthdayGreetingsEnabled`); `features/check-in-card/**` (+specs); `domains/birthdays/**` (+spec); `features/birthdays/**` (+spec); `domains/scheduler/{daily-club.service,clubs-due}.ts` (+spec); `features/update-me/**`; `features/get-me/schemas.ts`; `features/update-member-profile/**`; `features/get-member-progress/{get-member-progress.feature,get-member-progress.handler}.ts` (+spec); `features/update-workspace-settings/**`; `features/get-workspace-settings/**`; `domains/users/configs/users-events.config.ts`; `app/app.module.ts`; `shared/access/route-tier-consistency.spec.ts` (if the pinned list needs it); `apps/server-e2e/src/{attendance/check-in-card,birthdays/birthdays}.e2e-spec.ts`; `open-api.json`, `libs/api-client/src/openapi/*` | 2 d |
| S2 mobile | `apps/mobile/src/features/attendance/{CheckInScreen,SessionAttendanceScreen,ScanCardSheet}.tsx`, `features/attendance/scan-queue.ts` (+spec); `shared/check-in-card-store.ts` (+spec); `shared/api/{check-in-card,birthdays,me}.ts`; `features/profile/EditNameModal.tsx`; `features/home/HomeScreen.tsx` | 1.5 d |
| S3 admin + demo + docs | `apps/admin/src/features/dashboard/BirthdaysToday.tsx` (+spec); `app/(dashboard)/workspace/[workspaceId]/page.tsx`; `…/users/[userId]/page.tsx`; `features/users/{ProfileEditForm,CheckInCardSheet}.tsx` (+specs); `features/notifications/BirthdayGreetingsToggle.tsx`; `…/settings/notifications/page.tsx`; `shared/api/{birthdays,check-in-card}.ts` (new), `shared/api/{members,workspaces}.ts`; `apps/server/src/domains/demo/{demo-club.plan,ritm-demo.plan}.ts` (+plan specs); `docs/demo.md`; `docs/design/2026-11-08-admin-cleanup.md` (§9 status E9); `CHANGELOG.md` | 1.5 d |

Interfaces: §1 (card format, refusals), §3.1 routes and DTOs (`MyCheckInCardOutput`,
`MemberCheckInCardOutput`, `LookupCheckInCardInput/Output`), §3.2 `dateOfBirth` on `UpdateMeInput`,
`MeOutput`, `UpdateMemberProfileFeatureInput/Output`, member progress; §3.4 `ListBirthdaysTodayOutput`,
`birthdayGreetingsEnabled` on workspace settings (the demo keeps the default).

Checks for the integrator: tsc server / admin / mobile; `-- check-in-card`, `-- birthdays`,
`-- daily-club`, `-- update-me`, `-- update-member-profile`, `-- get-member-progress`,
`-- update-workspace-settings`, `-- demo-club.plan`, `-- ritm-demo.plan`, `-- route-tier-consistency`,
`-- workspace-id-source`; admin and mobile unit tests; server e2e `attendance/*`, `birthdays/*`,
`demo/*`; contract drift; `npm run test:admin-e2e`; `cs-reviewer` before merge.

## 12. Open risks

- **A shared screenshot of a card** lets a friend be marked as the card's owner if the coach doesn't look.
  The photo and name on the result strip are the control. Members without a photo show initials only.
  Accepted; the 6-character code has the same weakness (it can be read out over a chat).
- **Camera on the web build/PWA:** `CameraView` availability is checked by `useQrScanAvailable.ts`; where
  it's absent the «Сканировать» button is hidden and the coach taps names.
- **Club-local midnight vs UTC dates.** `dateOfBirth` is stored as UTC midnight; comparing month-day of the
  stored value with the club-local `ymd` is correct (no time-zone shift on a date). The 29 Feb rule is
  covered by unit tests.
- **Two clubs, two greetings** for a person in both. That's intended (each club is the sender), but it may
  read as noise; club mute applies per club.
- **Legal reading of the greeting.** It's a service notice of the club the member joined, not advertising,
  as long as no offer is added. Add «поздравления с днём рождения» to the consent purposes in the next
  consent edition (lawyer list, `docs/legal/README.md`).
- **The daily pass grows a third step.** The query per club is one indexed member read plus JS filtering;
  a failure releases the club-day claim and retries at 11:00 like the other steps.
- [INFERENCE] `ProfileEditForm` is shared with `MyProfileDialog.tsx`. The date field is shown only where
  the caller passes `dateOfBirth` in `initial`, so the admin's own-profile dialog doesn't change unless S3
  decides to add it.
