# Attendance / Check-in — v1 Design

Status: reviewed (3 adversarial agent passes reconciled — see §12)
Date: 2026-07-02
Branch: `feat/attendance-v1`

## 1. Context

The platform models the club **schedule** but never records who showed up:

- `GroupScheduleSlot` — recurring weekly slots (`dayOfWeek`, `startTime`,
  `durationMin`, optional `effectiveFrom`/`effectiveUntil`). Occurrences are **not**
  materialized; `get-workspace-schedule.handler.ts` expands slots over dates on the
  fly and emits `occurrenceId = "${slot.id}:${dateStr}"` (line 178) — the same shape
  as this spec's `occurrenceKey`.
- `ScheduleException` — cancels a slot/group over a date range.
- `WorkspaceEvent` — one-off events with `startAt`/`endAt` and their **own**
  `timezone` column (it does not consult gym tz).
- Rosters key on **`User`**: `GroupMember.userId`, `Group.coachId`.
- The workspace **owner** is `Workspace.ownerId` (a `User`) and is **not guaranteed**
  to have a `WorkspaceMember` row.
- The mobile app already renders dated, tz-correct occurrences
  (`apps/mobile/src/features/schedule/ClubScheduleScreen.tsx`); the admin
  app has **no** occurrence list, only a slot/exception editor.

No attendance model exists today.

## 2. Scope (v1 — locked)

- **Coach marks the roster; the coach is the source of truth.** No member self
  check-in and no QR in v1.
- **Sessions:** recurring group-class occurrences (from `GroupScheduleSlot`) + ad-hoc
  coach-created sessions + one-off `WorkspaceEvent`s.
- **Roster = group members + guests.** A guest is any **ACTIVE** workspace member
  marked at a session they are not a group member of. (Unregistered trial/walk-in
  guests with no account are deferred — §13.)
- **Present-only.** Record exists ⇒ present; no record ⇒ absent. No late/excused.
- **Capture only.** No booking/capacity/waitlist.

## 3. Chosen approach

Materialize an `AttendanceSession` + `AttendanceRecord` (Approach A of three; B =
denormalized keyless rows, C = polymorphic target). A materialized session gives one
attendance target and one read path across scheduled / ad-hoc / event, keeps
session-level metadata clean, and extends to analytics. An `AttendanceSession`
**wraps** a `WorkspaceEvent` via `workspaceEventId` rather than attendance pointing at
the event directly — one uniform `records` relation is worth one row per event, and
Postgres/Prisma has no clean polymorphic FK.

## 4. Data model (Prisma)

Applied via `prisma db push` (no migrations committed — no prod data). Add the two
models plus the back-relations enumerated below (all four `User` relations are
**required** or `prisma validate`/`db push` fails with "missing opposite relation
field").

```prisma
model AttendanceSession {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  groupId String? @db.Uuid                                    // null for event sessions
  group   Group?  @relation(fields: [groupId], references: [id], onDelete: SetNull)
  slotId  String? @db.Uuid                                    // set only for scheduled occurrences
  slot    GroupScheduleSlot? @relation(fields: [slotId], references: [id], onDelete: SetNull)
  sessionDate DateTime? @db.Date                              // occurrence date in resolved tz

  workspaceEventId String? @db.Uuid                           // thin wrapper over a one-off event
  workspaceEvent   WorkspaceEvent? @relation(fields: [workspaceEventId], references: [id], onDelete: SetNull)

  // Single dedupe key across all three kinds. Formatted ONLY in attendance-utils.ts:
  //   scheduled: "slot:<slotId>:<yyyy-mm-dd>"
  //   ad-hoc:    "adhoc:<groupId>:<yyyy-mm-ddThh:mm>"   (local minute in resolved tz)
  //   event:     "event:<workspaceEventId>"
  occurrenceKey String @db.VarChar(128)

  title    String   @db.VarChar(255)   // denormalized at creation → history-stable
  startAt  DateTime                     // UTC instant, resolved per §8
  timezone String   @db.VarChar(64)     // resolved zone (mirrors schedule/event)

  coachId     String? @db.Uuid          // ran it (display); default group primary / event coach
  coach       User?   @relation("SessionCoach",     fields: [coachId],     references: [id], onDelete: SetNull)
  createdById String  @db.Uuid
  createdBy   User    @relation("SessionCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  notes   String? @db.Text
  records AttendanceRecord[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([workspaceId, occurrenceKey])   // dedupes scheduled + ad-hoc + event uniformly
  @@index([workspaceId, startAt])
  @@index([groupId, startAt])
}

model AttendanceRecord {
  id        String            @id @default(uuid()) @db.Uuid
  sessionId String            @db.Uuid
  session   AttendanceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  // Denormalized from the session so the hot member read (/me) and workspace-scoped
  // counts are a single indexable scan (records have no other path to workspaceId,
  // and userId is global across workspaces).
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Keyed on User (NOT WorkspaceMember): matches GroupMember/Group.coachId, lets the
  // owner be marked, and preserves history when a member is removed from the club.
  userId String @db.Uuid
  user   User   @relation("AttendanceUser", fields: [userId], references: [id], onDelete: Cascade)

  isGuest Boolean?   // point-in-time capture; null for event sessions (no group). Never recomputed.

  markedById String   @db.Uuid
  markedBy   User     @relation("AttendanceMarkedBy", fields: [markedById], references: [id], onDelete: Restrict)
  markedAt   DateTime @default(now())

  @@unique([sessionId, userId])            // present-once ⇒ idempotent
  @@index([workspaceId, userId, markedAt]) // /me + per-member history + workspace scoping
  @@index([sessionId])
}
```

Required back-relations to add:
- `User`: `sessionsCoached AttendanceSession[] @relation("SessionCoach")`,
  `sessionsCreated AttendanceSession[] @relation("SessionCreatedBy")`,
  `attendanceRecords AttendanceRecord[] @relation("AttendanceUser")`,
  `recordsMarked AttendanceRecord[] @relation("AttendanceMarkedBy")`.
- `Workspace`: `attendanceSessions AttendanceSession[]`, `attendanceRecords AttendanceRecord[]`.
- `Group`, `GroupScheduleSlot`, `WorkspaceEvent`: `attendanceSessions AttendanceSession[]`.

`onDelete` notes: `SetNull` on group/slot/event preserves history (denormalized
`title`/`startAt`/`timezone` keep the row renderable). `Restrict`/`Cascade` on the
User FKs are **belt-and-suspenders against a hard-delete path that does not exist
today** — `UsersService.deleteAccount` anonymizes (`status=DELETED`) rather than
deleting the row, so attendance persists under an anonymized user; nothing scrubs it.
Group-scoped history disappears under its old `groupId` when a group is hard-deleted
(by design); workspace-wide reads still render the row, and per-member history (§6) is
user-scoped so it is unaffected.

## 5. Occurrence resolution — create-or-find (NOT upsert)

`POST …/attendance/sessions` takes an occurrence descriptor and resolves a session by
`(workspaceId, occurrenceKey)`. **Do not use Prisma `upsert`**: on a compound
`@@unique` it compiles to SELECT-then-INSERT (not `ON CONFLICT`), leaving a TOCTOU
window where two concurrent calls both INSERT and one gets P2002. Use create-or-find:

```
try { return await prisma.attendanceSession.create({ data }) }
catch (e) { if (isP2002(e)) return prisma.attendanceSession.findUniqueOrThrow({
  where: { workspaceId_occurrenceKey: { workspaceId, occurrenceKey } } }); throw e }
```

The P2002 branch is the **expected** concurrent path, not an error. An opened-but-empty
session is a legitimate state (class held; roster being taken; nobody came) — this is
why session resolution and record marking are separate endpoints (§6).

Descriptor kinds (`occurrenceKey` formatted in the single `attendance-utils.ts` helper):
- **Scheduled** `{ kind:'scheduled', slotId, sessionDate }` — validate (§7), derive
  `groupId` from slot, `timezone`/`startAt` (§8), key `"slot:<slotId>:<yyyy-mm-dd>"`.
- **Ad-hoc** `{ kind:'adhoc', groupId, startAt, title }` — `slotId` null,
  `sessionDate = date(startAt in resolved tz)`, key normalized to the local **minute**
  in the resolved tz: `"adhoc:<groupId>:<yyyy-mm-ddThh:mm>"` (prevents double-tap
  duplicates 300 ms apart).
- **Event** `{ kind:'event', workspaceEventId }` — group/slot null,
  `title`/`startAt`/`timezone` copied from the event, key `"event:<workspaceEventId>"`.

## 6. API surface

Under `workspaces/:workspaceId/attendance/…`, guards `AuthGuard, WorkspaceMemberGuard,
RoleGuard`. Vertical slices (`*.controller.ts`/`*.feature.ts`/`*.handler.ts`, shared
`schemas.ts` + `attendance-utils.ts`), `FeaturesBus`, `nestjs-zod` DTOs. **Every
controller method needs a unique name** (the open-api `operationIdFactory` uses
methodKey only — generic names collide and renumber the whole generated client). **DTO
classes need globally-unique names** (schema names derive from the class name, consumed
directly by both frontends). Handlers return **mapped DTOs via a `serializeSession`
helper**, never raw Prisma entities (matches `serializeEvent`).

| Method (route) | operationId / DTOs | Auth |
|---|---|---|
| `POST /sessions` | `createSession` — `CreateAttendanceSessionInput` (discriminated union on `kind`) → `AttendanceSessionOutput` | `COACHING_ROLES` + handler: group → `assertCanWriteGroup(groupId)`; event → `canWriteAllGroups(ctx)` |
| `GET /sessions?from&to&groupId?&curPage&perPage` | `listSessions` → `AttendanceSessionListOutput` (paginated). 90-day range cap; inverted/oversized range → `BadRequestError` | `COACHING_ROLES`, scoped by `canSeeAllGroups` |
| `GET /sessions/:id/roster` | `getSessionRoster` → `SessionRosterOutput` = `{ kind, roster: RosterEntry[] }`, `RosterEntry = { userId, displayName, present, isGuest }` — one uniform shape | `COACHING_ROLES` (+ group scope) |
| `POST /sessions/:id/records` | `markRecords` — `MarkRecordsInput { userIds: string[] }` → updated `SessionRosterOutput` | `COACHING_ROLES` (+ group scope) |
| `DELETE /sessions/:id/records/:userId` | `unmarkRecord` | `COACHING_ROLES` (+ group scope) |
| `DELETE /sessions/:id` | `deleteSession` (records cascade) | `COACHING_ROLES` (+ group scope) |
| `GET /me?from&to&curPage&perPage` | `getMyAttendance` → `MyAttendanceOutput { sessions[], total, rangeCount }` (streak deferred — §13). 90-day cap + pagination | any workspace member |
| `GET /overview` | `getAttendanceOverview` → `AttendanceOverviewOutput { sessionsHeld, totalCheckIns, distinctAttendees }` over last N days (minimal; "hasn't attended in N days" deferred — §13) | `COACHING_ROLES`, scoped |

Roster reads: for group sessions, pre-populate `roster` from group members
(`present=false` until marked) plus any marked guests; for event sessions, `roster` =
marked attendees only. Adding an attendee is a search over the **existing**
`list-workspace-members` (already paginated + `q`), not a roster sub-shape.

Record writes are **incremental** (`POST`/`DELETE` of ids), so two coaches on one class
don't clobber each other and the mat-side "tick as they arrive" maps directly.

**Per-member history (v1):** extend `get-member-progress` output with an attendance
summary — `attendanceCount`, recent sessions — **user-scoped (aggregated across the
member's groups)**, so a promotion-decision read doesn't undercount a multi-group
student. This, not `/overview`, is the primary v1 read.

## 7. Marking path (spelled out)

`markRecords` is three queries + one insert, in this order:
1. `workspaceMember.findMany({ where:{ workspaceId, status:'ACTIVE', userId:{ in:userIds } }, select:{ userId:true } })` → diff against `userIds`; unknown/inactive → `BadRequestError` with the offending ids. **Special-case `userId === workspace.ownerId`: allow** (the owner has no `WorkspaceMember` row). `accessUntil` expiry does **not** block marking.
2. For group sessions: `groupMember.findMany({ where:{ groupId, userId:{ in } } })` → compute `isGuest = !isGroupMember` per user. Event sessions: `isGuest = null`.
3. Build `data[]` with per-user `isGuest`, then `createMany({ data, skipDuplicates:true })` — a re-mark is success, not 409.

**Scheduled occurrence validity** (reject in `createSession`) reuses a predicate
**factored out of** `get-workspace-schedule.handler.ts:129-152` into shared utils so the
two features cannot drift: slot ∈ group ∈ workspace; `weekday(sessionDate) ==
slot.dayOfWeek`; date within `[effectiveFrom, effectiveUntil]`; not covered by a
`ScheduleException`.

## 8. Timezone

Two explicit rules (there is no single three-tier chain in the code):
- **Event session** → `session.timezone = workspaceEvent.timezone` (copy).
- **Group session (scheduled/ad-hoc)** → `session.timezone = group.gym?.timezone ??
  workspace.timezone`, mirroring `get-workspace-schedule.handler.ts:164`.

Compute `startAt` with `wallClockToUtc(wallClock, tz)` + the `TZDate` construction —
**lift `wallClockToUtc` into shared utils** (currently duplicated verbatim in
`create-workspace-event.handler.ts:32` and `update-workspace-event.handler.ts:25`, and
re-implemented inline in the schedule handler).

## 9. Authorization

Decide in the handler via `RbacService`, not `@Roles` alone. `resolveCoachScope`
(owner bypass: `workspace.ownerId === userId ⇒ 'admin'`), then `assertCanWriteGroup(ctx,
groupId)` for group sessions. **Event sessions have no group** → there is no dedicated
event helper; gate with `if (!rbac.canWriteAllGroups(ctx)) throw ForbiddenError`. Reads
(`GET /sessions`, `/overview`) scope by `canSeeAllGroups` as `get-workspace-stats` does.

Role note: `resolveCoachScope` grants `moderator` admin scope, but `COACHING_ROLES`
excludes `moderator`, so a moderator can't reach these handlers. That's intentional
here (attendance is a coaching action); all attendance routes use `COACHING_ROLES`
uniformly (no `STAFF_ROLES` widening).

## 10. Idempotency, concurrency, errors

- Session resolution: create-or-find on P2002 (§5) — concurrent duplicates converge.
- Marking: `createMany({ skipDuplicates:true })` — already-present is success.
  Un-marking a not-present user is a no-op success.
- No cross-endpoint transaction needed; each endpoint is independently idempotent.
- Deleting a session cascades records; deleting group/slot/event nulls the link.
- Unknown/inactive user, slot/date mismatch, cancelled occurrence, oversized date
  range → `BadRequestError`/`ForbiddenError`/`NotFoundError` from `shared/errors`.

## 11. Frontend + contract mechanics

**Marking UI is mobile-first** (reversed from an earlier draft): the coach is on the
mat with a phone, mobile already renders the occurrence list
(`ClubScheduleScreen`), and admin has no occurrence surface to hang it on.
- **Mobile (Expo):** each schedule occurrence row (already carrying `slotId` +
  `sessionDate`) gets a "Take attendance" action → `POST /sessions` → roster with
  checkboxes. Requirements: **"mark all present"** default + **tap-toggle** (tap =
  present, tap again = remove) instead of a destructive-feeling delete. Plus a "My
  attendance" screen (`GET /me`).
- **Admin (Next.js):** read/analytics surfaces — session list/history, per-member
  attendance on the member profile, `/overview` card. Coach marking mirrored into admin
  (owner backfill from a desk) is fast-follow.

**Contract regen (must land in the same PR as the frontend wrappers, or CI drift-gate +
typecheck fail):**
1. `npx nx open-api:generate @clubspace/server` → commit `open-api.json`
   (`generate-open-api.tool.ts`, headless, no DB).
2. `npx nx types:generate @clubspace/api-client` → commit
   `libs/api-client/src/openapi/{index.ts,types.gen.ts}`.
3. The admin `shared/sdk` axios SDK is **dead/stale and not in CI** — do **not**
   regenerate it. Hand-write `apps/admin/src/shared/api/attendance.ts` and
   `apps/mobile/src/shared/api/attendance.ts` wrappers over `ApiTypes.*`
   (the established pattern; see `apps/admin/src/shared/api/events.ts`).
4. The `CreateAttendanceSessionInput` discriminated union is the **first `oneOf` in the
   whole contract** — the plan must actually run the regen and eyeball the generated TS
   union (zod4 `discriminatedUnion` → `oneOf` → hey-api union is verified to work, but
   unproven through this exact pipeline; `oneOf` ships without a `discriminator`
   keyword, which is fine for TS narrowing on the `kind` const).

## 12. Design-review resolutions

First adversarial pass (settled): record keyed on `User`; single `occurrenceKey`
unique; wrap `WorkspaceEvent`; authorize via `RbacService`; `isGuest` point-in-time;
share the slot-validity predicate; two idempotent endpoints over one transactional
`/mark`.

Second pass (three agents) — accepted: create-or-find over `upsert` (compound-unique
race); spelled-out 3-query marking path + owner special-case; corrected two-rule tz
precedence; four named `User` back-relations; denormalized `workspaceId` on the record;
normalized ad-hoc `occurrenceKey`; uniform roster response; unique method/DTO names;
pagination + 90-day range cap; exact contract-regen steps + dead admin SDK; `/overview`
→ `COACHING_ROLES`; **mobile-first marking**; schedule→attendance wiring; mark-all /
tap-toggle; per-member history on `get-member-progress`.

Refined / not accepted as-is: **streak deferred** (a reviewer wanted it pinned in the
DTO; deferring avoids shipping an ambiguous cadence definition and matches the product
priority of history over gamification — ship it right later). **`/overview` absence
anti-join deferred** to fast-follow with its notification (avoid shipping half a churn
feature); v1 `/overview` is simple counts, which the denormalized `workspaceId` already
serves.

## 13. Out of scope (v1) / explicit deferrals

- Booking / capacity / waitlist; member self check-in; QR / kiosk.
- **Unregistered trial/walk-in guest** (no account) — v1 guests must be existing ACTIVE
  members; a name-only guest (`guestName` or light guest entity) is fast-follow and
  touches the model.
- **Excused / expected-absent** (esp. kids "parent said won't come") — deferred; there
  is no parent/guardian relationship in the model to attach it to anyway.
- **Attendance streak** on `/me` — deferred until the cadence definition is pinned.
- **"Hasn't attended in ≥N days" churn list** + its notification — shipped together as a
  fast-follow, not split across releases.
- Belt/rank/promotion integration (no rank model exists yet).

## 14. Known limitation (flag, not fixed here)

A workspace owner **without** a `WorkspaceMember` row would be rejected at
`AuthGuard`/`RoleGuard` before any handler runs (`RolesService.getRole` throws with no
member row). This works today only because the seed owner is given an `admin` member
row. If generic `WorkspaceService.createWorkspace` is ever wired to a route without
creating a member row, a guard-level owner bypass is needed. Pre-existing platform
concern, out of scope for attendance. (The marking path §7 already special-cases the
owner as a *marked attendee*, which is independent of this guard-level gap.)
