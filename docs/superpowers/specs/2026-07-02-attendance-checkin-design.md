# Attendance / Check-in — v1 Design

Status: draft for review
Date: 2026-07-02
Branch: `feat/attendance-v1`

## 1. Context

The platform already models the club **schedule** but never records who actually
showed up:

- `GroupScheduleSlot` — recurring weekly slots (`dayOfWeek`, `startTime`,
  `durationMin`, optional `effectiveFrom`/`effectiveUntil`). Occurrences are
  **not** materialized; the schedule screen expands slots over dates on the fly
  (`get-workspace-schedule.handler.ts`).
- `ScheduleException` — cancels a slot/group over a date range.
- `WorkspaceEvent` — one-off events (seminars) with `startAt`/`endAt` and their
  own `timezone`.
- Rosters are keyed on **`User`**: `GroupMember.userId`, `Group.coachId`.
- The workspace **owner** is `Workspace.ownerId` (a `User`) and is **not
  guaranteed** to have a `WorkspaceMember` row (`WorkspaceService.createWorkspace`
  does not create one; only the seed owner currently gets an `admin` member row).

There is no attendance model of any kind today.

## 2. Scope (v1 — locked)

- **Coach marks the roster; the coach is the source of truth.** No member
  self check-in and no QR in v1.
- **Sessions that can have attendance:** recurring group-class occurrences (from
  `GroupScheduleSlot`) + ad-hoc coach-created sessions (open mat, extra class) +
  one-off `WorkspaceEvent`s (seminars).
- **Roster = group members + guests.** A guest is any **ACTIVE** workspace member
  marked at a session they are not a group member of (cross-training / drop-in).
- **Present-only.** A record exists ⇒ present; no record ⇒ absent. No
  late/excused statuses.
- **Capture only.** No booking/capacity/waitlist in v1.

## 3. Chosen approach

**Materialize an `AttendanceSession` entity + `AttendanceRecord`** (Approach A of
three considered; B = denormalized keyless rows, C = polymorphic attendance
target). A materialized session gives a single attendance target and one read
path across scheduled / ad-hoc / event, keeps session-level metadata clean, and
extends naturally to later analytics. An `AttendanceSession` **wraps** a
`WorkspaceEvent` (via `workspaceEventId`) rather than attendance pointing at the
event directly — one uniform `records` relation is worth one denormalized row per
event, and there is no clean polymorphic FK in Postgres/Prisma.

This design incorporates an adversarial review; the material corrections are
recorded in §12.

## 4. Data model (Prisma)

Schema changes are applied via `prisma db push` (no migrations committed — no prod
data yet). Add the two models below plus back-relation fields on `Workspace`,
`Group`, `GroupScheduleSlot`, `WorkspaceEvent`, and `User`.

```prisma
model AttendanceSession {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Group session (from a slot or ad-hoc). Null for pure event sessions.
  groupId String? @db.Uuid
  group   Group?  @relation(fields: [groupId], references: [id], onDelete: SetNull)

  // Set when this is a concrete occurrence of a recurring slot.
  slotId String?            @db.Uuid
  slot   GroupScheduleSlot? @relation(fields: [slotId], references: [id], onDelete: SetNull)

  // Calendar date of the occurrence (in the session's resolved timezone).
  sessionDate DateTime? @db.Date

  // Thin wrapper over a one-off event; when set, group/slot are null.
  workspaceEventId String?         @db.Uuid
  workspaceEvent   WorkspaceEvent? @relation(fields: [workspaceEventId], references: [id], onDelete: SetNull)

  // Single dedupe key across all three kinds. Formatted in ONE place
  // (attendance-utils.ts):
  //   scheduled: "slot:<slotId>:<yyyy-mm-dd>"
  //   ad-hoc:    "adhoc:<groupId>:<startAt-iso>"
  //   event:     "event:<workspaceEventId>"
  occurrenceKey String @db.VarChar(128)

  title    String   @db.VarChar(255) // denormalized at creation → history-stable
  startAt  DateTime                   // UTC instant; resolved with event→gym→ws tz
  timezone String   @db.VarChar(64)   // resolved zone, mirrors schedule projection

  coachId     String? @db.Uuid  // who ran it (display only); default = group primary / event coach
  coach       User?   @relation("SessionCoach",     fields: [coachId],     references: [id], onDelete: SetNull)
  createdById String  @db.Uuid
  createdBy   User    @relation("SessionCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  notes   String? @db.Text
  records AttendanceRecord[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([workspaceId, occurrenceKey]) // dedupes scheduled + ad-hoc + event uniformly
  @@index([workspaceId, startAt])
  @@index([groupId, startAt])
}

model AttendanceRecord {
  id        String            @id @default(uuid()) @db.Uuid
  sessionId String            @db.Uuid
  session   AttendanceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  // Keyed on User (NOT WorkspaceMember): matches GroupMember/Group.coachId,
  // lets the owner be marked, and preserves history when a member is removed
  // from the workspace (only User account deletion cascades).
  userId String @db.Uuid
  user   User   @relation("AttendanceUser", fields: [userId], references: [id], onDelete: Cascade)

  // Point-in-time capture: was the user a group member when marked?
  // Null for event sessions (no group). Never recomputed.
  isGuest Boolean?

  markedById String   @db.Uuid
  markedBy   User     @relation("AttendanceMarkedBy", fields: [markedById], references: [id], onDelete: Restrict)
  markedAt   DateTime @default(now())

  @@unique([sessionId, userId])          // present-once ⇒ idempotent
  @@index([userId, markedAt])            // member history
  @@index([sessionId])
}
```

Rationale for the load-bearing choices:

- **`AttendanceRecord.userId → User`** (not `workspaceMemberId`). The owner has no
  guaranteed `WorkspaceMember` row, and every other roster in the codebase keys on
  `User`. Guest eligibility ("ACTIVE workspace member") is enforced in the handler
  at write time, not by FK. Removing a member from the club does **not** erase
  their attendance history.
- **`onDelete: SetNull`** on `group`/`slot`/`workspaceEvent`; `Restrict` on
  `createdById`/`markedById`. History survives roster churn; the audit actor
  cannot vanish. `title`/`startAt`/`timezone` are denormalized so a deleted source
  still renders.
- **Single `@@unique([workspaceId, occurrenceKey])`.** A `@@unique([slotId,
  sessionDate])` would leave ad-hoc sessions (both with `slotId = NULL`)
  un-deduped in Postgres, splitting a roster across two "Open Mat" rows on the same
  evening. The derived `occurrenceKey` collapses all three kinds into one
  constraint and avoids a partial unique index that `db push` cannot express.

## 5. Occurrence semantics — resolve-or-create

`POST …/attendance/sessions` takes an occurrence descriptor and **upserts** by
`(workspaceId, occurrenceKey)`. Concurrent callers converge on the same session id
(the unique constraint serializes creation). An opened-but-empty session is a
legitimate state (class held; roster being taken; nobody came) — it is not an
orphan to prevent, which is why session resolution and record marking are separate
endpoints (§6).

- **Scheduled** — descriptor `{ kind: 'scheduled', slotId, sessionDate }`. Validate
  (§7), derive `groupId` from the slot, `timezone` and `startAt` (§8),
  `occurrenceKey = "slot:<slotId>:<yyyy-mm-dd>"`.
- **Ad-hoc** — descriptor `{ kind: 'adhoc', groupId, startAt, title }`. `slotId`
  null, `sessionDate = date(startAt in resolved tz)`,
  `occurrenceKey = "adhoc:<groupId>:<startAt-iso>"`. Ad-hoc dedupe is best-effort
  (same group + same instant); to extend an existing ad-hoc session the coach opens
  it from the session list and marks by `sessionId`.
- **Event** — descriptor `{ kind: 'event', workspaceEventId }`. `group`/`slot`
  null, `title`/`startAt`/`timezone` copied from the event,
  `occurrenceKey = "event:<workspaceEventId>"`.

`occurrenceKey` formatting lives in exactly one helper (`attendance-utils.ts`); two
call sites formatting it differently would defeat the constraint.

## 6. API surface

All routes under `workspaces/:workspaceId/attendance/…`, guarded by
`AuthGuard, WorkspaceMemberGuard, RoleGuard`. Coach/staff endpoints carry
`@Roles(COACHING_ROLES)` (`['admin','head_coach','coach']`) as the coarse gate;
the real decision is made in the handler via `RbacService` (§9). Vertical
feature-slice layout (`*.controller.ts` / `*.feature.ts` / `*.handler.ts`, shared
`schemas.ts` + `attendance-utils.ts`), executed through `FeaturesBus`, DTOs via
`nestjs-zod`.

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /sessions` | Resolve-or-create a session from an occurrence descriptor. Returns the session. | `COACHING_ROLES` + `assertCanWriteGroup(groupId)`; events require `admin` scope (workspace-level) |
| `GET /sessions?from&to&groupId?` | List sessions in a date range with attendee counts, scoped by `canSeeAllGroups`. | `COACHING_ROLES` |
| `GET /sessions/:id/roster` | Group members with a "present" flag + already-marked guests. For events: marked attendees + member search to add. | `COACHING_ROLES` (+ group scope) |
| `POST /sessions/:id/records` | Body `{ userIds: string[] }`. Mark present; validate each is an ACTIVE workspace member; compute `isGuest` at write time; `createMany({ skipDuplicates: true })`. | `COACHING_ROLES` (+ group scope) |
| `DELETE /sessions/:id/records/:userId` | Un-mark (delete the record ⇒ absent). | `COACHING_ROLES` (+ group scope) |
| `DELETE /sessions/:id` | Delete a mistaken session (records cascade). | `COACHING_ROLES` (+ group scope) |
| `GET /me?from&to` | Current member's own attended sessions + count/current streak (mobile). | any workspace member (`WorkspaceMemberGuard`) |
| `GET /overview` | Light owner analytics: sessions held, total check-ins, distinct active attendees over last N days, "hasn't attended in ≥N days" list. | `STAFF_ROLES`, scoped by `canSeeAllGroups` |

Record writes are **incremental** (`POST`/`DELETE` of user ids), not "replace the
whole present-set", so two coaches marking the same class do not clobber each
other, and the mat-side UX (tick students as they arrive) maps directly.

## 7. Validation (scheduled occurrences)

Factor the slot-validity predicate out of `get-workspace-schedule.handler.ts`
(currently inline: weekday match, `effectiveFrom`/`effectiveUntil` bounds,
`ScheduleException` overlap) into a shared util used by **both** the schedule
projection and attendance, so they cannot drift. A scheduled `POST /sessions` is
rejected when:

- the slot does not belong to a group in this workspace, or
- `weekday(sessionDate) !== slot.dayOfWeek`, or
- `sessionDate` is outside `[effectiveFrom, effectiveUntil]`, or
- `sessionDate` is covered by a `ScheduleException` for that slot/group.

Guests: each marked `userId` must be a workspace member with `status = ACTIVE`
(validated in the handler, mirroring how `create-workspace-event` validates
coaches). An expired `accessUntil` does **not** block marking — attendance is a
physical fact.

## 8. Timezone

Precedence (matching the existing schedule/event handlers): **event.timezone →
gym.timezone → workspace.timezone**. Store the resolved zone on
`AttendanceSession.timezone`. Compute `startAt` with the existing
`wallClockToUtc(wallClock, tz)` helper and `TZDate` construction (reuse, don't
re-implement — the helper is currently duplicated across the event handlers and
should be lifted into shared utils as part of this work).

## 9. Authorization

Do **not** trust `RoleGuard`/`@Roles` alone for the write decision. Resolve the
caller's scope in the handler with `RbacService.resolveCoachScope`, then
`assertCanWriteGroup(ctx, groupId)` for group sessions. This helper already bakes
in the owner bypass (`workspace.ownerId === userId ⇒ 'admin'`), `coachSeesAllGroups`,
and the `GroupCoach` junction check. Event sessions are workspace-level and require
`admin` scope. Reads (`GET /sessions`, `/overview`) are scoped by `canSeeAllGroups`
the same way `get-workspace-stats` scopes.

## 10. Idempotency, concurrency, error handling

- **Session resolution** is an upsert on `(workspaceId, occurrenceKey)` — safe
  under concurrency; duplicate descriptors return the same session.
- **Marking** uses `createMany({ skipDuplicates: true })`; a user already marked
  present is a **success**, not a 409. Un-marking a user who is not present is a
  no-op success.
- No shared transaction is required across resolve + mark, because each endpoint
  is independently idempotent by its own unique constraint.
- Deleting a session cascades its records; deleting a group/slot/event nulls the
  link and leaves the session (denormalized fields keep it renderable).
- Guest of non-`ACTIVE` status, unknown `userId`, slot/date mismatch, or a
  cancelled occurrence → 400/403 with a clear message.

## 11. Frontend touchpoints

- **Admin (Next.js):** coach "Take attendance" screen reachable from the schedule /
  group (open session → roster → tick present); group attendance history list;
  owner analytics card fed by `GET /overview`.
- **Mobile (Expo):** "My attendance" screen (`GET /me`) — history + count/streak.
  Coach mat-side marking can also live in mobile in a later iteration; v1 marking
  UI lands in admin first.
- New endpoints expand the contract surface → regenerate `open-api.json` and the
  generated `ApiTypes`/api-client, or the CI drift gate fails. Budget for it.

## 12. Design-review resolutions (adversarial pass)

Accepted after verifying against code:

1. Record keyed on `User`, not `WorkspaceMember` — owner can be marked; matches
   `GroupMember`/`Group.coachId`; history survives member removal.
2. Single `occurrenceKey` unique constraint — closes the ad-hoc dedupe hole a
   `[slotId, sessionDate]` unique would leave open (Postgres treats NULLs as
   distinct).
3. Timezone precedence event → gym → workspace, resolved zone stored on the
   session; reuse `wallClockToUtc`/`TZDate`.
4. Authorize via `RbacService` in the handler (owner bypass lives there), not
   `RoleGuard` alone.
5. `isGuest` is an immutable point-in-time capture (nullable; null for events).
6. Share the slot-validity predicate between schedule and attendance.

Rejected / refined:

- Reviewer proposed a single `POST /mark` that resolves-or-creates the session and
  writes records in one transaction (to avoid an "orphan" empty session).
  **Refined to two independently-idempotent endpoints** (`POST /sessions` +
  `POST /sessions/:id/records`): an opened-but-empty session is a legitimate state,
  separated concerns are cleaner, no shared transaction is needed, and incremental
  per-arrival marking (the real mat-side UX) does not re-send the occurrence
  descriptor on every tap.

## 13. Out of scope (v1)

Booking / capacity / waitlist; member self check-in; QR / kiosk; late/excused
statuses; attendance-driven notifications (e.g. a "hasn't attended in 2 weeks"
churn alert — a strong fast-follow, but not now); belt/rank progression
integration.

## 14. Known limitation (flag, not fixed here)

A workspace owner **without** a `WorkspaceMember` row would be rejected at
`AuthGuard`/`RoleGuard` before any handler runs (`RolesService.getRole` throws when
there is no member row). This works today only because the seed owner is given an
`admin` member row. If the generic `WorkspaceService.createWorkspace` is ever wired
to a route without creating a member row, a guard-level owner bypass is needed.
This is a pre-existing platform concern, not introduced by attendance, and is out
of scope for this spec.
