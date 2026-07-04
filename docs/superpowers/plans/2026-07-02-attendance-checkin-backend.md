# Attendance / Check-in (Backend v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side attendance capture — a coach materializes a class/event session and marks who was present — plus member and staff read endpoints, behind the existing typed API contract.

**Architecture:** Two Prisma models (`AttendanceSession` + `AttendanceRecord`, records keyed on `User`, single `occurrenceKey` unique). Vertical NestJS feature slices under `apps/server/src/features/attendance-*/`, executed via `FeaturesBus`, authorized in-handler via `RbacService`. Shared pure helpers (`attendance-utils.ts`) for occurrence-key formatting, timezone resolution, and slot-validity — reused from the schedule feature so the two can't drift. Frontend (mobile marking UI + admin reads) is a **separate follow-up plan**.

**Tech Stack:** NestJS, `@shelfjs/features`, Prisma 7 / Postgres, `nestjs-zod` + zod 4, `@date-fns/tz` (`TZDate`), Jest. Contract: `open-api.json` → `@hey-api/typescript` → `libs/api-client`.

## Global Constraints

- Schema changes apply via `npx prisma db push` only — **do not** create or commit `apps/server/prisma/migrations/` (no prod data yet).
- No Claude attribution in commit messages.
- All routes: `workspaces/:workspaceId/attendance/...`, guarded `AuthGuard, WorkspaceMemberGuard, RoleGuard`.
- Every controller method name is globally unique (the open-api `operationIdFactory` uses methodKey only). Every `createZodDto` class name is globally unique (schema names derive from it).
- Attendance write/list/roster/records/delete routes: `@Roles(COACHING_ROLES)` (`['admin','head_coach','coach']`); real decision in-handler via `RbacService`. `/me` = any workspace member (no `@Roles`). `/overview` = `COACHING_ROLES`.
- Errors: throw `BadRequestError`/`NotFoundError`/`ForbiddenError` from `apps/server/src/shared/errors/shared.errors`.
- Handlers return mapped DTOs via a `serialize*` helper, never raw Prisma entities.
- Timezone: event session → `workspaceEvent.timezone`; group session → `gym?.timezone ?? workspace.timezone`.
- `accessUntil` expiry must NOT block marking. The workspace **owner** (`workspace.ownerId`) has no `WorkspaceMember` row and must be allowed as a marked attendee (special-case).

**Reference files to copy patterns from (read before starting):**
- Feature slice: `apps/server/src/features/manage-workspace-events/{create-workspace-event.feature.ts,create-workspace-event.handler.ts,workspace-events.controller.ts,schemas.ts}`
- Authz: `apps/server/src/shared/services/rbac.service.ts` (`resolveCoachScope`, `canSeeAllGroups`, `canWriteAllGroups`, `assertCanWriteGroup`)
- Slot predicate + `TZDate`: `apps/server/src/features/get-workspace-schedule/get-workspace-schedule.handler.ts:128-199`
- Pagination shape: `apps/server/src/features/list-videos/list-videos.feature.ts`
- P2002 handling: `apps/server/src/features/send-auth-code/send-auth-code.handler.ts:108-118` + its spec
- Handler/controller registration: `apps/server/src/app/app.module.ts`

**Test command used throughout:** `npx jest <path-to-spec> --config apps/server/jest.config.ts` (falls back to `npx nx test server` for the whole suite). Adjust the `--config` path if the runner differs; verify with one green run in Task 2.

---

### Task 1: Prisma models + back-relations

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (add two models; add back-relation fields to `User`, `Workspace`, `Group`, `GroupScheduleSlot`, `WorkspaceEvent`)

**Interfaces:**
- Produces: Prisma models `AttendanceSession`, `AttendanceRecord` with the fields the later tasks read/write; generated client types `Prisma.AttendanceSession*`, `Prisma.AttendanceRecord*`.

- [ ] **Step 1: Add the two models** at the end of `schema.prisma`:

```prisma
model AttendanceSession {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  groupId String? @db.Uuid
  group   Group?  @relation(fields: [groupId], references: [id], onDelete: SetNull)
  slotId  String? @db.Uuid
  slot    GroupScheduleSlot? @relation(fields: [slotId], references: [id], onDelete: SetNull)
  sessionDate DateTime? @db.Date

  workspaceEventId String? @db.Uuid
  workspaceEvent   WorkspaceEvent? @relation(fields: [workspaceEventId], references: [id], onDelete: SetNull)

  occurrenceKey String @db.VarChar(128)

  title    String   @db.VarChar(255)
  startAt  DateTime
  timezone String   @db.VarChar(64)

  coachId     String? @db.Uuid
  coach       User?   @relation("SessionCoach",     fields: [coachId],     references: [id], onDelete: SetNull)
  createdById String  @db.Uuid
  createdBy   User    @relation("SessionCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  notes   String? @db.Text
  records AttendanceRecord[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([workspaceId, occurrenceKey])
  @@index([workspaceId, startAt])
  @@index([groupId, startAt])
}

model AttendanceRecord {
  id        String            @id @default(uuid()) @db.Uuid
  sessionId String            @db.Uuid
  session   AttendanceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  workspaceId String    @db.Uuid
  workspace   Workspace @relation("WorkspaceAttendanceRecords", fields: [workspaceId], references: [id], onDelete: Cascade)

  userId String @db.Uuid
  user   User   @relation("AttendanceUser", fields: [userId], references: [id], onDelete: Cascade)

  isGuest Boolean?

  markedById String   @db.Uuid
  markedBy   User     @relation("AttendanceMarkedBy", fields: [markedById], references: [id], onDelete: Restrict)
  markedAt   DateTime @default(now())

  @@unique([sessionId, userId])
  @@index([workspaceId, userId, markedAt])
  @@index([sessionId])
}
```

- [ ] **Step 2: Add back-relation fields.** In `model User { ... }` add:

```prisma
  sessionsCoached   AttendanceSession[] @relation("SessionCoach")
  sessionsCreated   AttendanceSession[] @relation("SessionCreatedBy")
  attendanceRecords AttendanceRecord[]  @relation("AttendanceUser")
  recordsMarked     AttendanceRecord[]  @relation("AttendanceMarkedBy")
```

In `model Workspace { ... }` add:

```prisma
  attendanceSessions AttendanceSession[]
  attendanceRecords  AttendanceRecord[] @relation("WorkspaceAttendanceRecords")
```

In `model Group { ... }`, `model GroupScheduleSlot { ... }`, `model WorkspaceEvent { ... }` each add:

```prisma
  attendanceSessions AttendanceSession[]
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate --schema apps/server/prisma/schema.prisma`
Expected: `The schema at ... is valid 🚀` (no "missing opposite relation field").

- [ ] **Step 4: Push + regenerate client** (needs the dev Postgres up — see the local-stack recipe)

Run: `npx prisma db push --schema apps/server/prisma/schema.prisma && npx prisma generate --schema apps/server/prisma/schema.prisma`
Expected: "Your database is now in sync" + "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add apps/server/prisma/schema.prisma
git commit -m "feat(attendance): AttendanceSession + AttendanceRecord models"
```

---

### Task 2: Shared pure helpers (`attendance-utils.ts`)

**Files:**
- Create: `apps/server/src/features/attendance/attendance-utils.ts`
- Test: `apps/server/src/features/attendance/attendance-utils.spec.ts`

**Interfaces:**
- Produces:
  - `scheduledOccurrenceKey(slotId: string, sessionDate: string): string` (`sessionDate` = `yyyy-mm-dd`)
  - `adhocOccurrenceKey(groupId: string, localMinute: string): string`
  - `eventOccurrenceKey(eventId: string): string`
  - `localDateInTz(instant: Date, tz: string): string` → `yyyy-mm-dd`
  - `localMinuteInTz(instant: Date, tz: string): string` → `yyyy-mm-ddThh:mm`
  - `resolveGroupSessionTz(gymTz: string | null, workspaceTz: string): string`
  - `isoDayOfWeek(date: Date): number` (Mon=1..Sun=7, from UTC)
  - `isSlotActiveOn(slot: {dayOfWeek:number; effectiveFrom:Date|null; effectiveUntil:Date|null}, slotId: string, date: Date, exceptions: {slotId:string|null; fromDate:Date; untilDate:Date}[]): boolean`
  - `wallClockToUtc(wallClock: string, tz: string): Date` (lifted verbatim from `create-workspace-event.handler.ts:32-39`)
  - `isValidIanaTz(tz: string): boolean` (lifted from `create-workspace-event.handler.ts:19-26`)

- [ ] **Step 1: Write the failing tests**

```ts
import {
  scheduledOccurrenceKey, adhocOccurrenceKey, eventOccurrenceKey,
  localDateInTz, localMinuteInTz, resolveGroupSessionTz,
  isoDayOfWeek, isSlotActiveOn, wallClockToUtc, isValidIanaTz,
} from './attendance-utils'

describe('occurrenceKey formatters', () => {
  it('scheduled', () => expect(scheduledOccurrenceKey('s1', '2026-07-02')).toBe('slot:s1:2026-07-02'))
  it('adhoc', () => expect(adhocOccurrenceKey('g1', '2026-07-02T19:00')).toBe('adhoc:g1:2026-07-02T19:00'))
  it('event', () => expect(eventOccurrenceKey('e1')).toBe('event:e1'))
})

describe('tz-local formatting', () => {
  // 2026-07-02T16:00:00Z is 2026-07-02 21:00 in Asia/Krasnoyarsk (+05..+07 historically +07)
  const inst = new Date('2026-07-02T16:00:00Z')
  it('localMinuteInTz floors to the minute in the zone', () =>
    expect(localMinuteInTz(inst, 'Asia/Krasnoyarsk')).toBe('2026-07-02T23:00'))
  it('localDateInTz is the first 10 chars', () =>
    expect(localDateInTz(inst, 'Asia/Krasnoyarsk')).toBe('2026-07-02'))
  it('same instant, different date across zones', () =>
    expect(localDateInTz(new Date('2026-07-02T23:30:00Z'), 'Asia/Krasnoyarsk')).toBe('2026-07-03'))
})

describe('resolveGroupSessionTz', () => {
  it('prefers gym tz', () => expect(resolveGroupSessionTz('Asia/Tomsk', 'Europe/Moscow')).toBe('Asia/Tomsk'))
  it('falls back to workspace tz', () => expect(resolveGroupSessionTz(null, 'Europe/Moscow')).toBe('Europe/Moscow'))
})

describe('isoDayOfWeek', () => {
  it('Thursday 2026-07-02 -> 4', () => expect(isoDayOfWeek(new Date('2026-07-02T00:00:00Z'))).toBe(4))
  it('Sunday -> 7', () => expect(isoDayOfWeek(new Date('2026-07-05T00:00:00Z'))).toBe(7))
})

describe('isSlotActiveOn', () => {
  const slot = { dayOfWeek: 4, effectiveFrom: null, effectiveUntil: null }
  const thu = new Date('2026-07-02T00:00:00Z')
  it('active on matching weekday', () => expect(isSlotActiveOn(slot, 's1', thu, [])).toBe(true))
  it('inactive on wrong weekday', () =>
    expect(isSlotActiveOn(slot, 's1', new Date('2026-07-03T00:00:00Z'), [])).toBe(false))
  it('inactive before effectiveFrom', () =>
    expect(isSlotActiveOn({ ...slot, effectiveFrom: new Date('2026-08-01T00:00:00Z') }, 's1', thu, [])).toBe(false))
  it('cancelled by a covering exception (slot-specific)', () =>
    expect(isSlotActiveOn(slot, 's1', thu, [{ slotId: 's1', fromDate: new Date('2026-07-01T00:00:00Z'), untilDate: new Date('2026-07-03T00:00:00Z') }])).toBe(false))
  it('cancelled by a group-wide exception (slotId null)', () =>
    expect(isSlotActiveOn(slot, 's1', thu, [{ slotId: null, fromDate: thu, untilDate: thu }])).toBe(false))
  it('unaffected by an exception for another slot', () =>
    expect(isSlotActiveOn(slot, 's1', thu, [{ slotId: 's2', fromDate: thu, untilDate: thu }])).toBe(true))
})

describe('isValidIanaTz', () => {
  it('accepts a real zone', () => expect(isValidIanaTz('Europe/Moscow')).toBe(true))
  it('rejects garbage', () => expect(isValidIanaTz('Europe/Mosсow')).toBe(false)) // cyrillic с
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest apps/server/src/features/attendance/attendance-utils.spec.ts --config apps/server/jest.config.ts`
Expected: FAIL — "Cannot find module './attendance-utils'".

- [ ] **Step 3: Implement `attendance-utils.ts`**

```ts
import { TZDate } from '@date-fns/tz'

export const scheduledOccurrenceKey = (slotId: string, sessionDate: string) =>
  `slot:${slotId}:${sessionDate}`
export const adhocOccurrenceKey = (groupId: string, localMinute: string) =>
  `adhoc:${groupId}:${localMinute}`
export const eventOccurrenceKey = (eventId: string) => `event:${eventId}`

// yyyy-mm-ddThh:mm as seen in `tz`, floored to the minute. Uses en-CA so
// formatToParts yields zero-padded numeric fields we can reassemble.
export const localMinuteInTz = (instant: Date, tz: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  // en-CA renders midnight hour as '24'; normalise to '00'.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}
export const localDateInTz = (instant: Date, tz: string): string =>
  localMinuteInTz(instant, tz).slice(0, 10)

export const resolveGroupSessionTz = (gymTz: string | null, workspaceTz: string): string =>
  gymTz ?? workspaceTz

export const isoDayOfWeek = (date: Date): number => {
  const d = date.getUTCDay() // 0=Sun..6=Sat
  return d === 0 ? 7 : d
}

export const isSlotActiveOn = (
  slot: { dayOfWeek: number; effectiveFrom: Date | null; effectiveUntil: Date | null },
  slotId: string,
  date: Date,
  exceptions: { slotId: string | null; fromDate: Date; untilDate: Date }[],
): boolean => {
  if (slot.dayOfWeek !== isoDayOfWeek(date)) return false
  if (slot.effectiveFrom && date < slot.effectiveFrom) return false
  if (slot.effectiveUntil && date > slot.effectiveUntil) return false
  const cancelled = exceptions.some(
    (e) => (e.slotId === null || e.slotId === slotId) && e.fromDate <= date && e.untilDate >= date,
  )
  return !cancelled
}

// Lifted verbatim from create-workspace-event.handler.ts:32-39.
export const wallClockToUtc = (wallClock: string, tz: string): Date => {
  const [datePart, timePart] = wallClock.split('T')
  const [y, mo, d] = datePart.split('-').map((p) => parseInt(p, 10))
  const [h, mi, s] = timePart.split(':').map((p) => parseInt(p, 10))
  return new Date(new TZDate(y, mo - 1, d, h, mi, s ?? 0, tz).getTime())
}

// Lifted from create-workspace-event.handler.ts:19-26.
export const isValidIanaTz = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest apps/server/src/features/attendance/attendance-utils.spec.ts --config apps/server/jest.config.ts`
Expected: PASS (all describe blocks green). If the `--config` path is wrong, discover the right one now: `npx nx test server --testPathPattern=attendance-utils`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/features/attendance/attendance-utils.ts apps/server/src/features/attendance/attendance-utils.spec.ts
git commit -m "feat(attendance): shared occurrence-key/tz/slot-validity utils"
```

---

### Task 3: Output schemas + `serializeSession` / `serializeRoster`

**Files:**
- Create: `apps/server/src/features/attendance/schemas.ts`

**Interfaces:**
- Produces:
  - `AttendanceSessionOutputSchema` (zod) + `serializeSession(s)` → `{ id, workspaceId, groupId, slotId, workspaceEventId, sessionDate, title, startAt, timezone, coachId, notes, attendeeCount, createdAt, updatedAt }`
  - `SessionRosterOutputSchema` = `{ sessionId, kind: 'scheduled'|'adhoc'|'event', roster: RosterEntry[] }`, `RosterEntry = { userId, displayName, present, isGuest }`
  - `RosterEntrySchema`, `DeletedOutputSchema` (`{ status: 'deleted' }`)

- [ ] **Step 1: Implement `schemas.ts`** (no separate test — exercised by handler specs in Tasks 4-9):

```ts
import { z } from 'zod'

export const AttendanceSessionOutputSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  slotId: z.string().uuid().nullable(),
  workspaceEventId: z.string().uuid().nullable(),
  sessionDate: z.string().nullable(),          // yyyy-mm-dd
  title: z.string(),
  startAt: z.iso.datetime(),
  timezone: z.string(),
  coachId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  attendeeCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AttendanceSessionOutput = z.infer<typeof AttendanceSessionOutputSchema>

export const RosterEntrySchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  present: z.boolean(),
  isGuest: z.boolean().nullable(),
})
export const SessionRosterOutputSchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(['scheduled', 'adhoc', 'event']),
  roster: z.array(RosterEntrySchema),
})
export type SessionRosterOutput = z.infer<typeof SessionRosterOutputSchema>

export const DeletedOutputSchema = z.object({ status: z.literal('deleted') })

const toDateStr = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null

export const serializeSession = (s: {
  id: string; workspaceId: string; groupId: string | null; slotId: string | null
  workspaceEventId: string | null; sessionDate: Date | null; title: string
  startAt: Date; timezone: string; coachId: string | null; notes: string | null
  createdAt: Date; updatedAt: Date; _count?: { records: number }
}): AttendanceSessionOutput => ({
  id: s.id, workspaceId: s.workspaceId, groupId: s.groupId, slotId: s.slotId,
  workspaceEventId: s.workspaceEventId, sessionDate: toDateStr(s.sessionDate),
  title: s.title, startAt: s.startAt.toISOString(), timezone: s.timezone,
  coachId: s.coachId, notes: s.notes, attendeeCount: s._count?.records ?? 0,
  createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
})

// display name helper for rosters
export const displayName = (u: { firstname: string | null; lastname: string | null; email: string }): string =>
  [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.email
```

- [ ] **Step 2: Typecheck compiles**

Run: `npx tsc -p apps/server/tsconfig.app.json --noEmit`
Expected: no errors referencing `schemas.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/features/attendance/schemas.ts
git commit -m "feat(attendance): output schemas + serializers"
```

---

### Task 4: `POST /sessions` — resolve-or-create (`createSession`)

**Files:**
- Create: `apps/server/src/features/attendance/create-session.feature.ts`
- Create: `apps/server/src/features/attendance/create-session.handler.ts`
- Create: `apps/server/src/features/attendance/attendance.controller.ts` (grows across Tasks 4-9)
- Test: `apps/server/src/features/attendance/create-session.handler.spec.ts`

**Interfaces:**
- Consumes: utils (Task 2), `serializeSession` (Task 3), `RbacService`, `PrismaService`.
- Produces: `CreateAttendanceSessionFeature`, `CreateAttendanceSessionInputSchema` (discriminated union), `resolveSession(...)` behavior returning an `AttendanceSessionOutput`. Later tasks reference the created session by `id`.

- [ ] **Step 1: Write the feature (input contract)** in `create-session.feature.ts`:

```ts
import { z } from 'zod'
import { AttendanceSessionOutputSchema } from './schemas'

const WallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)

export const CreateAttendanceSessionInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scheduled'), slotId: z.string().uuid(), sessionDate: z.iso.date() }),
  z.object({ kind: z.literal('adhoc'), groupId: z.string().uuid(), startAt: WallClock, title: z.string().trim().min(1).max(255) }),
  z.object({ kind: z.literal('event'), workspaceEventId: z.string().uuid() }),
])
export const CreateAttendanceSessionOutputSchema = AttendanceSessionOutputSchema

export class CreateAttendanceSessionFeature {
  constructor(
    readonly payload: z.infer<typeof CreateAttendanceSessionInputSchema>,
    readonly workspaceId: string,
    readonly invokerUserId: string,
    readonly roleName: string | null,
    readonly isSuperAdmin: boolean,
  ) {}
}
export type CreateAttendanceSessionFeatureResponse = z.infer<typeof CreateAttendanceSessionOutputSchema>
```

- [ ] **Step 2: Write the failing handler spec** in `create-session.handler.spec.ts`. Mock `PrismaService` and `RbacService` as plain objects. Cover: scheduled resolve creates with the right `occurrenceKey`/`startAt`/`timezone`; a second identical call that hits P2002 returns the existing row (create-or-find); a wrong-weekday `sessionDate` throws `BadRequestError`; an event session copies title/startAt/timezone from the event and authorizes via `canWriteAllGroups`.

```ts
import { CreateAttendanceSessionHandler } from './create-session.handler'
import { CreateAttendanceSessionFeature } from './create-session.feature'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const makePrisma = (over: any = {}) => ({
  groupScheduleSlot: { findFirst: jest.fn() },
  scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
  workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }) },
  group: { findFirst: jest.fn() },
  workspaceEvent: { findFirst: jest.fn() },
  attendanceSession: {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  ...over,
})
const rbac = { resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin', userId: 'u1', workspaceId: 'w1', workspaceOwnerId: 'owner' }), assertCanWriteGroup: jest.fn(), canWriteAllGroups: jest.fn().mockReturnValue(true) }

const serialized = { id: 'sess1' }
const run = (prisma: any, payload: any) =>
  new CreateAttendanceSessionHandler(prisma as any, rbac as any).execute(
    new CreateAttendanceSessionFeature(payload, 'w1', 'u1', 'admin', false),
  )

describe('createSession — scheduled', () => {
  const slot = { id: 's1', groupId: 'g1', dayOfWeek: 4, startTime: '19:00', effectiveFrom: null, effectiveUntil: null, group: { id: 'g1', coachId: 'c1', gym: { timezone: null } } }

  it('creates with slot occurrence key and resolved tz/startAt', async () => {
    const prisma = makePrisma()
    prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
    prisma.attendanceSession.create.mockResolvedValue({ id: 'sess1', _count: { records: 0 } })
    await run(prisma, { kind: 'scheduled', slotId: 's1', sessionDate: '2026-07-02' })
    const data = prisma.attendanceSession.create.mock.calls[0][0].data
    expect(data.occurrenceKey).toBe('slot:s1:2026-07-02')
    expect(data.timezone).toBe('Europe/Moscow')
    expect(data.groupId).toBe('g1')
    expect(new Date(data.startAt).toISOString()).toBe('2026-07-02T16:00:00.000Z') // 19:00 Europe/Moscow (+3)
  })

  it('is idempotent: P2002 -> findUniqueOrThrow', async () => {
    const prisma = makePrisma()
    prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
    prisma.attendanceSession.create.mockRejectedValue(p2002())
    prisma.attendanceSession.findUniqueOrThrow.mockResolvedValue({ id: 'existing', _count: { records: 2 } })
    const out = await run(prisma, { kind: 'scheduled', slotId: 's1', sessionDate: '2026-07-02' })
    expect(prisma.attendanceSession.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { workspaceId_occurrenceKey: { workspaceId: 'w1', occurrenceKey: 'slot:s1:2026-07-02' } },
      include: { _count: { select: { records: true } } },
    })
    expect(out.id).toBe('existing')
  })

  it('rejects a sessionDate whose weekday != slot.dayOfWeek', async () => {
    const prisma = makePrisma()
    prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
    await expect(run(prisma, { kind: 'scheduled', slotId: 's1', sessionDate: '2026-07-03' })).rejects.toThrow(/not scheduled/i)
  })
})

describe('createSession — event', () => {
  it('copies title/startAt/timezone from the event and checks canWriteAllGroups', async () => {
    const prisma = makePrisma()
    prisma.workspaceEvent.findFirst.mockResolvedValue({ id: 'e1', title: 'Seminar', startAt: new Date('2026-07-10T09:00:00Z'), timezone: 'Asia/Tomsk' })
    prisma.attendanceSession.create.mockResolvedValue({ id: 'sess2', _count: { records: 0 } })
    await run(prisma, { kind: 'event', workspaceEventId: 'e1' })
    const data = prisma.attendanceSession.create.mock.calls[0][0].data
    expect(data.occurrenceKey).toBe('event:e1')
    expect(data.timezone).toBe('Asia/Tomsk')
    expect(data.title).toBe('Seminar')
    expect(rbac.canWriteAllGroups).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest apps/server/src/features/attendance/create-session.handler.spec.ts --config apps/server/jest.config.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the handler** in `create-session.handler.ts`:

```ts
import { Feature, IFeatureHandler } from '@shelfjs/features'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import {
  CreateAttendanceSessionFeature, CreateAttendanceSessionFeatureResponse,
} from './create-session.feature'
import { serializeSession } from './schemas'
import {
  scheduledOccurrenceKey, adhocOccurrenceKey, eventOccurrenceKey,
  resolveGroupSessionTz, localDateInTz, localMinuteInTz, isSlotActiveOn,
  wallClockToUtc, isoDayOfWeek,
} from './attendance-utils'

const isP2002 = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

const INCLUDE = { include: { _count: { select: { records: true } } } }

@Feature(CreateAttendanceSessionFeature)
export class CreateAttendanceSessionHandler
  implements IFeatureHandler<CreateAttendanceSessionFeature, CreateAttendanceSessionFeatureResponse>
{
  constructor(private readonly prisma: PrismaService, private readonly rbac: RbacService) {}

  async execute(f: CreateAttendanceSessionFeature) {
    const ctx = await this.rbac.resolveCoachScope({
      userId: f.invokerUserId, workspaceId: f.workspaceId,
      roleName: f.roleName, isSuperAdmin: f.isSuperAdmin,
    })

    const data = await this.buildData(f)          // authz done inside per-kind
    try {
      const created = await this.prisma.attendanceSession.create({ data, ...INCLUDE })
      return serializeSession(created)
    } catch (e) {
      if (!isP2002(e)) throw e
      const existing = await this.prisma.attendanceSession.findUniqueOrThrow({
        where: { workspaceId_occurrenceKey: { workspaceId: f.workspaceId, occurrenceKey: data.occurrenceKey } },
        ...INCLUDE,
      })
      return serializeSession(existing)
    }
  }

  private async buildData(f: CreateAttendanceSessionFeature) {
    const ctx = await this.rbac.resolveCoachScope({
      userId: f.invokerUserId, workspaceId: f.workspaceId, roleName: f.roleName, isSuperAdmin: f.isSuperAdmin,
    })
    const p = f.payload
    const base = { workspaceId: f.workspaceId, createdById: f.invokerUserId }

    if (p.kind === 'scheduled') {
      const slot = await this.prisma.groupScheduleSlot.findFirst({
        where: { id: p.slotId, group: { workspaceId: f.workspaceId } },
        include: { group: { include: { gym: { select: { timezone: true } } } } },
      })
      if (!slot) throw new NotFoundError({ message: 'Slot not found' })
      await this.rbac.assertCanWriteGroup(ctx, slot.groupId)

      const date = new Date(`${p.sessionDate}T00:00:00Z`)
      const exceptions = await this.prisma.scheduleException.findMany({
        where: { groupId: slot.groupId }, select: { slotId: true, fromDate: true, untilDate: true },
      })
      if (!isSlotActiveOn(slot, slot.id, date, exceptions)) {
        throw new BadRequestError({ message: 'Slot is not scheduled (or is cancelled) on that date' })
      }
      const workspace = await this.prisma.workspace.findUnique({ where: { id: f.workspaceId }, select: { timezone: true } })
      const tz = resolveGroupSessionTz(slot.group.gym?.timezone ?? null, workspace!.timezone)
      const startAt = wallClockToUtc(`${p.sessionDate}T${slot.startTime}`, tz)
      return {
        ...base, groupId: slot.groupId, slotId: slot.id, sessionDate: date,
        occurrenceKey: scheduledOccurrenceKey(slot.id, p.sessionDate),
        title: slot.group.name, startAt, timezone: tz, coachId: slot.group.coachId,
      }
    }

    if (p.kind === 'adhoc') {
      const group = await this.prisma.group.findFirst({
        where: { id: p.groupId, workspaceId: f.workspaceId },
        include: { gym: { select: { timezone: true } } },
      })
      if (!group) throw new NotFoundError({ message: 'Group not found' })
      await this.rbac.assertCanWriteGroup(ctx, group.id)
      const workspace = await this.prisma.workspace.findUnique({ where: { id: f.workspaceId }, select: { timezone: true } })
      const tz = resolveGroupSessionTz(group.gym?.timezone ?? null, workspace!.timezone)
      const startAt = wallClockToUtc(p.startAt, tz)
      const localMinute = localMinuteInTz(startAt, tz)
      return {
        ...base, groupId: group.id, sessionDate: new Date(`${localDateInTz(startAt, tz)}T00:00:00Z`),
        occurrenceKey: adhocOccurrenceKey(group.id, localMinute),
        title: p.title, startAt, timezone: tz, coachId: group.coachId,
      }
    }

    // event
    if (!this.rbac.canWriteAllGroups(ctx)) {
      throw new BadRequestError({ message: 'Only admin scope can take attendance for events' })
    }
    const event = await this.prisma.workspaceEvent.findFirst({
      where: { id: p.workspaceEventId, workspaceId: f.workspaceId },
      select: { id: true, title: true, startAt: true, timezone: true, coachId: true },
    })
    if (!event) throw new NotFoundError({ message: 'Event not found' })
    return {
      ...base, workspaceEventId: event.id, occurrenceKey: eventOccurrenceKey(event.id),
      title: event.title, startAt: event.startAt, timezone: event.timezone, coachId: event.coachId,
    }
  }
}
```

> Note: `resolveCoachScope` is called twice above only for clarity; in the real implementation hoist `ctx` into `execute` and pass it to `buildData(ctx, f)`. Do that refactor now (single call) — the spec asserts one authz resolution.

- [ ] **Step 5: Add the controller** `attendance.controller.ts` with the first route:

```ts
import { Body, Controller, Post, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
  CreateAttendanceSessionFeature, CreateAttendanceSessionInputSchema,
  CreateAttendanceSessionOutputSchema, type CreateAttendanceSessionFeatureResponse,
} from './create-session.feature'

class CreateAttendanceSessionInput extends createZodDto(CreateAttendanceSessionInputSchema) {}
class AttendanceSessionOutputDto extends createZodDto(CreateAttendanceSessionOutputSchema) {}

@Controller('workspaces/:workspaceId/attendance')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AttendanceController {
  constructor(private bus: FeaturesBus) {}

  @Post('sessions')
  @Roles(COACHING_ROLES)
  @ZodResponse({ type: AttendanceSessionOutputDto })
  async createSession(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateAttendanceSessionInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return await this.bus.execute<CreateAttendanceSessionFeature, CreateAttendanceSessionFeatureResponse>(
      new CreateAttendanceSessionFeature(body, workspaceId, user.userId, user.role?.name ?? null, user.isSuperAdmin),
    )
  }
}
```

- [ ] **Step 6: Register** `AttendanceController` + `CreateAttendanceSessionHandler` in `apps/server/src/app/app.module.ts` (add to the `controllers` array and the `providers` array next to the workspace-events entries).

- [ ] **Step 7: Run tests + typecheck**

Run: `npx jest apps/server/src/features/attendance/create-session.handler.spec.ts --config apps/server/jest.config.ts && npx tsc -p apps/server/tsconfig.app.json --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/features/attendance apps/server/src/app/app.module.ts
git commit -m "feat(attendance): POST /sessions resolve-or-create endpoint"
```

---

### Task 5: `POST /sessions/:id/records` + `DELETE /sessions/:id/records/:userId`

**Files:**
- Create: `apps/server/src/features/attendance/mark-records.feature.ts`, `mark-records.handler.ts`, `unmark-record.feature.ts`, `unmark-record.handler.ts`
- Modify: `attendance.controller.ts` (add `markRecords`, `unmarkRecord`), `app.module.ts` (register handlers)
- Test: `mark-records.handler.spec.ts`

**Interfaces:**
- Consumes: session created in Task 4, `RbacService`, `PrismaService`.
- Produces: `MarkRecordsFeature` (input `{ userIds: string[] }` → `SessionRosterOutput`), `UnmarkRecordFeature`.

- [ ] **Step 1: Write the failing spec** covering: only ACTIVE workspace members are inserted (an inactive/unknown userId → `BadRequestError` naming the id); the workspace **owner** (no member row) is allowed; `isGuest` computed against `GroupMember` (true when not in the session's group); event sessions insert `isGuest: null`; a re-mark is a no-op (uses `skipDuplicates`).

```ts
import { MarkRecordsHandler } from './mark-records.handler'
import { MarkRecordsFeature } from './mark-records.feature'

const makePrisma = (over: any = {}) => ({
  attendanceSession: { findFirst: jest.fn() },
  workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }) },
  workspaceMember: { findMany: jest.fn() },
  groupMember: { findMany: jest.fn().mockResolvedValue([]) },
  attendanceRecord: { createMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  ...over,
})
const rbac = { resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin', userId: 'u1', workspaceId: 'w1', workspaceOwnerId: 'owner' }), assertCanWriteGroup: jest.fn(), canWriteAllGroups: jest.fn().mockReturnValue(true) }
const run = (prisma: any, sessionId: string, userIds: string[]) =>
  new MarkRecordsHandler(prisma as any, rbac as any).execute(new MarkRecordsFeature({ userIds }, 'w1', sessionId, 'u1', 'admin', false))

describe('markRecords', () => {
  const groupSession = { id: 'sess1', workspaceId: 'w1', groupId: 'g1', slotId: 's1', workspaceEventId: null }

  it('rejects a non-ACTIVE / unknown userId', async () => {
    const prisma = makePrisma()
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession)
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }]) // m2 missing
    await expect(run(prisma, 'sess1', ['m1', 'm2'])).rejects.toThrow(/m2/)
  })

  it('allows the owner even without a member row', async () => {
    const prisma = makePrisma()
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession)
    prisma.workspaceMember.findMany.mockResolvedValue([]) // owner not a member
    prisma.groupMember.findMany.mockResolvedValue([])
    await run(prisma, 'sess1', ['owner'])
    const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data
    expect(rows).toEqual([expect.objectContaining({ userId: 'owner', isGuest: true, workspaceId: 'w1', sessionId: 'sess1' })])
  })

  it('computes isGuest against GroupMember', async () => {
    const prisma = makePrisma()
    prisma.attendanceSession.findFirst.mockResolvedValue(groupSession)
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }, { userId: 'm2' }])
    prisma.groupMember.findMany.mockResolvedValue([{ userId: 'm1' }]) // m2 is a guest
    await run(prisma, 'sess1', ['m1', 'm2'])
    const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'm1', isGuest: false }),
      expect.objectContaining({ userId: 'm2', isGuest: true }),
    ]))
  })

  it('event session marks isGuest null', async () => {
    const prisma = makePrisma()
    prisma.attendanceSession.findFirst.mockResolvedValue({ id: 'sess2', workspaceId: 'w1', groupId: null, slotId: null, workspaceEventId: 'e1' })
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }])
    await run(prisma, 'sess2', ['m1'])
    expect(prisma.attendanceRecord.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true })
    expect(prisma.attendanceRecord.createMany.mock.calls[0][0].data[0].isGuest).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx jest .../mark-records.handler.spec.ts ...` → FAIL (module not found).

- [ ] **Step 3: Implement `mark-records.feature.ts`:**

```ts
import { z } from 'zod'
import { SessionRosterOutputSchema } from './schemas'
export const MarkRecordsInputSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(200) })
export const MarkRecordsOutputSchema = SessionRosterOutputSchema
export class MarkRecordsFeature {
  constructor(
    readonly payload: z.infer<typeof MarkRecordsInputSchema>,
    readonly workspaceId: string, readonly sessionId: string,
    readonly invokerUserId: string, readonly roleName: string | null, readonly isSuperAdmin: boolean,
  ) {}
}
export type MarkRecordsFeatureResponse = z.infer<typeof MarkRecordsOutputSchema>
```

- [ ] **Step 4: Implement `mark-records.handler.ts`** — load the session (scope by workspace), authorize (`assertCanWriteGroup(groupId)` for group sessions, `canWriteAllGroups` for events), then the 3-query path:

```ts
import { Feature, IFeatureHandler } from '@shelfjs/features'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { MarkRecordsFeature, MarkRecordsFeatureResponse } from './mark-records.feature'
import { buildRoster } from './roster'   // created in Task 6

@Feature(MarkRecordsFeature)
export class MarkRecordsHandler implements IFeatureHandler<MarkRecordsFeature, MarkRecordsFeatureResponse> {
  constructor(private readonly prisma: PrismaService, private readonly rbac: RbacService) {}

  async execute(f: MarkRecordsFeature) {
    const ctx = await this.rbac.resolveCoachScope({
      userId: f.invokerUserId, workspaceId: f.workspaceId, roleName: f.roleName, isSuperAdmin: f.isSuperAdmin,
    })
    const session = await this.prisma.attendanceSession.findFirst({
      where: { id: f.sessionId, workspaceId: f.workspaceId },
      select: { id: true, workspaceId: true, groupId: true, slotId: true, workspaceEventId: true },
    })
    if (!session) throw new NotFoundError({ message: 'Session not found' })
    if (session.groupId) await this.rbac.assertCanWriteGroup(ctx, session.groupId)
    else if (!this.rbac.canWriteAllGroups(ctx)) throw new BadRequestError({ message: 'Only admin scope can mark event attendance' })

    const ids = [...new Set(f.payload.userIds)]
    const workspace = await this.prisma.workspace.findUnique({ where: { id: f.workspaceId }, select: { ownerId: true } })

    // (1) validate ACTIVE membership; owner is allowed without a member row.
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: f.workspaceId, status: 'ACTIVE', userId: { in: ids } }, select: { userId: true },
    })
    const allowed = new Set(members.map((m) => m.userId))
    if (workspace?.ownerId) allowed.add(workspace.ownerId)
    const unknown = ids.filter((id) => !allowed.has(id))
    if (unknown.length) throw new BadRequestError({ message: `Not active workspace members: ${unknown.join(', ')}` })

    // (2) isGuest per user (group sessions only).
    let guestOf = (userId: string): boolean | null => null
    if (session.groupId) {
      const gm = await this.prisma.groupMember.findMany({
        where: { groupId: session.groupId, userId: { in: ids } }, select: { userId: true },
      })
      const inGroup = new Set(gm.map((g) => g.userId))
      guestOf = (userId: string) => !inGroup.has(userId)
    }

    // (3) insert; re-marks are a no-op.
    await this.prisma.attendanceRecord.createMany({
      data: ids.map((userId) => ({
        sessionId: session.id, workspaceId: f.workspaceId, userId,
        isGuest: guestOf(userId), markedById: f.invokerUserId,
      })),
      skipDuplicates: true,
    })

    return buildRoster(this.prisma, session)
  }
}
```

- [ ] **Step 5: Implement `unmark-record.feature.ts` + `unmark-record.handler.ts`** — same session-load + authz, then `attendanceRecord.deleteMany({ where: { sessionId, userId } })` (deleteMany so a not-present user is a no-op success), return `buildRoster`. (Full code mirrors Task 5 handler head; write it out, don't reference "same as".)

- [ ] **Step 6: Wire both routes** into `attendance.controller.ts`:

```ts
  @Post('sessions/:sessionId/records')
  @Roles(COACHING_ROLES)
  @ZodResponse({ type: SessionRosterOutputDto })
  async markRecords(@Param('workspaceId') workspaceId: string, @Param('sessionId') sessionId: string,
    @Body() body: MarkRecordsInputDto, @CurrentUser() user: CurrentUserPayload) {
    return this.bus.execute<MarkRecordsFeature, MarkRecordsFeatureResponse>(
      new MarkRecordsFeature(body, workspaceId, sessionId, user.userId, user.role?.name ?? null, user.isSuperAdmin))
  }

  @Delete('sessions/:sessionId/records/:userId')
  @Roles(COACHING_ROLES)
  @ZodResponse({ type: SessionRosterOutputDto })
  async unmarkRecord(@Param('workspaceId') workspaceId: string, @Param('sessionId') sessionId: string,
    @Param('userId') userId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.bus.execute<UnmarkRecordFeature, UnmarkRecordFeatureResponse>(
      new UnmarkRecordFeature(workspaceId, sessionId, userId, user.userId, user.role?.name ?? null, user.isSuperAdmin))
  }
```

Add the DTO classes (`MarkRecordsInputDto`, `SessionRosterOutputDto`) and imports; register both handlers in `app.module.ts`.

- [ ] **Step 7: Run + commit**

Run: `npx jest apps/server/src/features/attendance/mark-records.handler.spec.ts --config apps/server/jest.config.ts && npx tsc -p apps/server/tsconfig.app.json --noEmit`
Expected: PASS.

```bash
git add apps/server/src/features/attendance apps/server/src/app/app.module.ts
git commit -m "feat(attendance): mark/unmark records endpoints"
```

---

### Task 6: `GET /sessions/:id/roster` + shared `buildRoster`

**Files:**
- Create: `apps/server/src/features/attendance/roster.ts` (shared `buildRoster`), `get-roster.feature.ts`, `get-roster.handler.ts`
- Modify: `attendance.controller.ts`, `app.module.ts`
- Test: `roster.spec.ts`

**Interfaces:**
- Produces: `buildRoster(prisma, session): Promise<SessionRosterOutput>` used by Tasks 5 & 6; `GetRosterFeature`.

- [ ] **Step 1: Failing test for `buildRoster`** — group session pre-populates group members (`present:false` until marked) + marked guests; event session returns marked attendees only; `kind` derived from slotId/workspaceEventId.

```ts
import { buildRoster } from './roster'
const prisma = () => ({
  groupMember: { findMany: jest.fn() },
  attendanceRecord: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
})
it('group roster: members present flags + guest', async () => {
  const p = prisma()
  p.groupMember.findMany.mockResolvedValue([{ userId: 'm1', user: { firstname: 'A', lastname: null, email: 'a@x' } }])
  p.attendanceRecord.findMany.mockResolvedValue([{ userId: 'm1', isGuest: false }, { userId: 'g9', isGuest: true }])
  p.user.findMany.mockResolvedValue([{ id: 'g9', firstname: 'Guest', lastname: null, email: 'g@x' }])
  const out = await buildRoster(p as any, { id: 'sess1', groupId: 'grp', slotId: 's1', workspaceEventId: null })
  expect(out.kind).toBe('scheduled')
  expect(out.roster).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: 'm1', present: true, isGuest: false }),
    expect.objectContaining({ userId: 'g9', present: true, isGuest: true }),
  ]))
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `roster.ts`:**

```ts
import { PrismaService } from '../../infrastructure/prisma'
import { SessionRosterOutput, displayName } from './schemas'

type SessionLike = { id: string; groupId: string | null; slotId: string | null; workspaceEventId: string | null }
const kindOf = (s: SessionLike) => (s.workspaceEventId ? 'event' : s.slotId ? 'scheduled' : 'adhoc') as const

export const buildRoster = async (prisma: PrismaService, s: SessionLike): Promise<SessionRosterOutput> => {
  const records = await prisma.attendanceRecord.findMany({
    where: { sessionId: s.id }, select: { userId: true, isGuest: true },
  })
  const present = new Map(records.map((r) => [r.userId, r.isGuest]))
  const entries = new Map<string, { userId: string; displayName: string; present: boolean; isGuest: boolean | null }>()

  if (s.groupId) {
    const gm = await prisma.groupMember.findMany({
      where: { groupId: s.groupId },
      select: { userId: true, user: { select: { firstname: true, lastname: true, email: true } } },
    })
    for (const m of gm) {
      entries.set(m.userId, {
        userId: m.userId, displayName: displayName(m.user),
        present: present.has(m.userId), isGuest: present.has(m.userId) ? present.get(m.userId)! : false,
      })
    }
  }
  // Add marked users not already in the roster (guests, or event attendees).
  const missing = [...present.keys()].filter((id) => !entries.has(id))
  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: missing } }, select: { id: true, firstname: true, lastname: true, email: true },
    })
    for (const u of users) {
      entries.set(u.id, { userId: u.id, displayName: displayName(u), present: true, isGuest: present.get(u.id) ?? null })
    }
  }
  return { sessionId: s.id, kind: kindOf(s), roster: [...entries.values()] }
}
```

- [ ] **Step 4: Implement `get-roster.feature.ts` + `get-roster.handler.ts`** (load session scoped to workspace, authz read-scope via `assertCanWriteGroup` for group sessions or `canSeeAllGroups` for events, call `buildRoster`), wire `GET sessions/:sessionId/roster` (`getSessionRoster`), register, run, commit.

Run: `npx jest apps/server/src/features/attendance/roster.spec.ts --config apps/server/jest.config.ts`
Expected: PASS.

```bash
git add apps/server/src/features/attendance apps/server/src/app/app.module.ts
git commit -m "feat(attendance): GET session roster"
```

---

### Task 7: `GET /sessions` (list, paginated, scoped) + `DELETE /sessions/:id`

**Files:**
- Create: `list-sessions.feature.ts`, `list-sessions.handler.ts`, `delete-session.feature.ts`, `delete-session.handler.ts`
- Modify: `attendance.controller.ts`, `app.module.ts`
- Test: `list-sessions.handler.spec.ts`

**Interfaces:**
- Consumes: `RbacService.canSeeAllGroups`, `serializeSession`.
- Produces: `ListSessionsFeature` (`{ from?, to?, groupId?, curPage?, perPage? }` → `{ data, total, curPage, perPage }`), `DeleteSessionFeature`.

- [ ] **Step 1: Failing spec** — a >90-day range throws `BadRequestError`; a coach with `coach_own_only` scope only gets sessions of their own groups; results are paginated with `_count.records`.

```ts
it('rejects a range wider than 90 days', async () => {
  await expect(run({ from: '2026-01-01', to: '2026-12-31' })).rejects.toThrow(/range/i)
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Input schema (copy `list-videos.feature.ts` pagination shape, add `from`/`to` as `z.iso.date().optional()` and `groupId` optional). Handler: resolve scope; if `!canSeeAllGroups(ctx)`, restrict `where.group.coaches = { some: { userId: ctx.userId } }` (GroupCoach junction, mirroring `assertCanWriteGroup`); validate the range (reuse a 90-day constant; throw `BadRequestError` on inverted/oversized — do NOT copy the schedule handler's `NotFoundError`); `findMany` with `include: { _count: { select: { records: true } } }`, `orderBy: { startAt: 'desc' }`, `skip/take`; `count` for `total`; map with `serializeSession`.

- [ ] **Step 4: Implement `delete-session`** — load session scoped to workspace, authz (`assertCanWriteGroup` for group sessions else `canWriteAllGroups`), `attendanceSession.delete` (records cascade), return `{ status: 'deleted' }`.

- [ ] **Step 5: Wire `listSessions` (GET sessions) + `deleteSession` (DELETE sessions/:sessionId), register, run, commit.**

```bash
git commit -m "feat(attendance): list + delete sessions"
```

---

### Task 8: `GET /me` (member's own attendance)

**Files:** `get-my-attendance.feature.ts`, `get-my-attendance.handler.ts`, controller + module; Test: `get-my-attendance.handler.spec.ts`

**Interfaces:**
- Produces: `GetMyAttendanceFeature` (`{ from?, to?, curPage?, perPage? }` → `{ sessions: AttendanceSessionOutput[], total, rangeCount }`). No `@Roles` — any workspace member.

- [ ] **Step 1: Failing spec** — queries `attendanceRecord` by `{ workspaceId, userId }` (uses the `[workspaceId, userId, markedAt]` index), returns that member's sessions newest-first with `total` and `rangeCount`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Handler reads `attendanceRecord.findMany({ where: { workspaceId, userId, markedAt range }, include: { session: { include: { _count: { select: { records: true } } } } }, orderBy: { markedAt: 'desc' }, skip, take })`, maps `r.session` through `serializeSession`; `rangeCount` = count of records in range; `total` = count of all the member's records in the workspace. Controller `GET me` (`getMyAttendance`), `user.userId` from `@CurrentUser`, no `@Roles`. Register.
- [ ] **Step 4: Run + commit** `feat(attendance): GET /me member attendance`.

---

### Task 9: `GET /overview` (staff counts)

**Files:** `get-overview.feature.ts`, `get-overview.handler.ts`, controller + module; Test: `get-overview.handler.spec.ts`

**Interfaces:**
- Produces: `GetAttendanceOverviewFeature` (`{ days? }` default 30 → `{ sessionsHeld, totalCheckIns, distinctAttendees }`). `@Roles(COACHING_ROLES)`, scoped by `canSeeAllGroups`.

- [ ] **Step 1: Failing spec** — over the last N days: `sessionsHeld` = session count, `totalCheckIns` = record count, `distinctAttendees` = distinct `userId` count; a `coach_own_only` caller is scoped to own groups.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Compute `since = now - days`. `sessionsHeld = attendanceSession.count({ where: { workspaceId, startAt: { gte: since }, ...scope } })`; `totalCheckIns = attendanceRecord.count({ where: { workspaceId, markedAt: { gte: since }, ...scope } })`; `distinctAttendees = (await attendanceRecord.findMany({ where: {...}, distinct: ['userId'], select: { userId: true } })).length`. For `!canSeeAllGroups`, scope both via `session: { group: { coaches: { some: { userId: ctx.userId } } } }`. (The "hasn't attended in N days" absence list is out of scope — §13.)
- [ ] **Step 4: Run + commit** `feat(attendance): GET /overview counts`.

---

### Task 10: Per-member attendance on `get-member-progress`

**Files:**
- Modify: `apps/server/src/features/get-member-progress/get-member-progress.{feature,handler}.ts`
- Test: extend `get-member-progress.handler.spec.ts` (or create if absent)

**Interfaces:**
- Consumes: `AttendanceRecord` keyed on `userId` (user-scoped, across all the member's groups).
- Produces: adds `attendance: { count: number; recent: AttendanceSessionOutput[] }` to the member-progress output schema.

- [ ] **Step 1: Failing spec** — for a member, `attendance.count` = their record count in the workspace (across groups), `attendance.recent` = up to 10 newest sessions.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In the handler, after the existing progress load, `attendanceRecord.findMany({ where: { workspaceId, userId: memberUserId }, include: { session: { include: { _count: { select: { records: true } } } } }, orderBy: { markedAt: 'desc' }, take: 10 })` + a `count`. Extend the output zod schema with the `attendance` object (reuse `AttendanceSessionOutputSchema` imported from `../attendance/schemas`). Map via `serializeSession`.
- [ ] **Step 4: Run + commit** `feat(attendance): surface attendance on member progress`.

---

### Task 11: Regenerate the typed contract

**Files:**
- Modify (generated): `open-api.json`, `libs/api-client/src/openapi/{index.ts,types.gen.ts}`

- [ ] **Step 1: Regenerate the OpenAPI document**

Run: `npx nx open-api:generate @bjj-academy/server`
Expected: `open-api.json` updated with the 8 new operationIds (`createSession`, `listSessions`, `getSessionRoster`, `markRecords`, `unmarkRecord`, `deleteSession`, `getMyAttendance`, `getAttendanceOverview`) and the new schemas (`CreateAttendanceSessionInput`, `AttendanceSessionOutput`, `SessionRosterOutput`, `MarkRecordsInput`, `MyAttendanceOutput`, `AttendanceOverviewOutput`).

- [ ] **Step 2: Eyeball the discriminated union** — confirm `CreateAttendanceSessionInput` appears in `open-api.json` as a `oneOf` of three branches each with a `kind` const (this is the first `oneOf` in the contract). Confirm no existing `Create2..N`/`Remove2..N` aliases renumbered (unique method names should prevent it).

- [ ] **Step 3: Regenerate the TS client**

Run: `npx nx types:generate @bjj-academy/api-client`
Expected: `libs/api-client/src/openapi/types.gen.ts` gains `ApiTypes.CreateAttendanceSessionInput` (a TS union), `ApiTypes.AttendanceSessionOutput`, `ApiTypes.SessionRosterOutput`, etc.

- [ ] **Step 4: Confirm the CI drift gate would pass**

Run: `git diff --exit-code -- open-api.json libs/api-client/src/openapi || echo "expected: files changed and now staged"`
Then build the client: `npx nx build @bjj-academy/api-client`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add open-api.json libs/api-client/src/openapi
git commit -m "chore(attendance): regenerate API contract + client types"
```

---

## Self-Review

**Spec coverage:** §4 model → T1; §5 resolve-or-find + occurrenceKey → T2/T4; §6 all 8 endpoints → T4-T9 + roster T6; per-member history → T10; §7 marking path + owner special-case + slot validity → T2/T5; §8 tz two-rule → T2/T4; §9 authz → in every handler; §10 idempotency → T4/T5; §11 contract regen → T11. Frontend (§11 mobile-first UI) is intentionally a separate plan. Deferred items (§13: streak, absence list, trial guests) are not implemented — correct.

**Placeholder scan:** Tasks 5-10 leave some mechanical controller/feature scaffolding described rather than fully inlined (e.g. `unmark-record`, `delete-session`, the `/me` and `/overview` feature files). These follow the exact verified pattern shown fully in Tasks 4-5; the implementer copies that structure with the stated deltas. Logic-bearing code (utils, resolve-or-find, marking 3-query path, buildRoster) is complete. Acceptable, but if executing via subagents, expand each such step to full code at task start.

**Type consistency:** `AttendanceSessionOutput`/`serializeSession` (T3) consumed identically in T4/T7/T8/T10; `SessionRosterOutput`/`buildRoster` (T3/T6) consumed in T5/T6; `MarkRecordsFeature` signature matches its controller call; `_count: { records }` include used consistently wherever `attendeeCount` is serialized.
