import { CreateAttendanceSessionFeature } from './create-session.feature'
import { CreateAttendanceSessionHandler } from './create-session.handler'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

// A full row shaped like what Prisma returns, so serializeSession works on
// the handler's return value. Individual tests assert on the create *input*.
const dbSession = (over: Record<string, unknown> = {}) => ({
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: 's1',
    workspaceEventId: null,
    sessionDate: new Date('2026-07-02T00:00:00Z'),
    title: 'Morning',
    startAt: new Date('2026-07-02T16:00:00Z'),
    timezone: 'Europe/Moscow',
    coachId: 'c1',
    notes: null,
    createdAt: new Date('2026-07-02T16:00:00Z'),
    updatedAt: new Date('2026-07-02T16:00:00Z'),
    _count: { records: 0 },
    ...over,
})

const makePrisma = () => ({
    groupScheduleSlot: { findFirst: jest.fn() },
    scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    group: { findFirst: jest.fn() },
    workspaceEvent: { findFirst: jest.fn() },
    attendanceSession: {
        create: jest.fn().mockResolvedValue(dbSession()),
        findUniqueOrThrow: jest.fn(),
    },
})

const makeRbac = () => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: 'admin',
        userId: 'u1',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    }),
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(true),
})

const run = (prisma: any, rbac: any, payload: any) =>
    new CreateAttendanceSessionHandler(prisma, rbac).execute(
        new CreateAttendanceSessionFeature(payload, 'w1', 'u1', 'admin', false),
    )

const slot = {
    id: 's1',
    groupId: 'g1',
    dayOfWeek: 4, // Thursday; 2026-07-02 is a Thursday
    startTime: '19:00',
    effectiveFrom: null,
    effectiveUntil: null,
    group: { id: 'g1', name: 'Morning', coachId: 'c1', gym: { timezone: null } },
}

describe('createSession — scheduled', () => {
    it('creates with slot occurrence key, resolved tz and startAt', async () => {
        const prisma = makePrisma()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
        await run(prisma, makeRbac(), {
            kind: 'scheduled',
            slotId: 's1',
            sessionDate: '2026-07-02',
        })
        const data = prisma.attendanceSession.create.mock.calls[0][0].data
        expect(data.occurrenceKey).toBe('slot:s1:2026-07-02')
        expect(data.timezone).toBe('Europe/Moscow')
        expect(data.groupId).toBe('g1')
        expect(data.title).toBe('Morning')
        // 19:00 Europe/Moscow (+3) -> 16:00Z
        expect(new Date(data.startAt).toISOString()).toBe(
            '2026-07-02T16:00:00.000Z',
        )
    })

    it('is idempotent: P2002 -> findUniqueOrThrow returns the existing row', async () => {
        const prisma = makePrisma()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
        prisma.attendanceSession.create.mockRejectedValue(p2002())
        prisma.attendanceSession.findUniqueOrThrow.mockResolvedValue(
            dbSession({ id: 'existing', _count: { records: 2 } }),
        )
        const out = await run(prisma, makeRbac(), {
            kind: 'scheduled',
            slotId: 's1',
            sessionDate: '2026-07-02',
        })
        expect(
            prisma.attendanceSession.findUniqueOrThrow,
        ).toHaveBeenCalledWith({
            where: {
                workspaceId_occurrenceKey: {
                    workspaceId: 'w1',
                    occurrenceKey: 'slot:s1:2026-07-02',
                },
            },
            include: { _count: { select: { records: true } } },
        })
        expect(out.id).toBe('existing')
        expect(out.attendeeCount).toBe(2)
    })

    it('rejects a sessionDate whose weekday != slot.dayOfWeek', async () => {
        const prisma = makePrisma()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(slot)
        await expect(
            run(prisma, makeRbac(), {
                kind: 'scheduled',
                slotId: 's1',
                sessionDate: '2026-07-03', // Friday
            }),
        ).rejects.toThrow(/not scheduled/i)
    })

    it('404s an unknown slot', async () => {
        const prisma = makePrisma()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(null)
        await expect(
            run(prisma, makeRbac(), {
                kind: 'scheduled',
                slotId: 'nope',
                sessionDate: '2026-07-02',
            }),
        ).rejects.toThrow(/slot not found/i)
    })
})

describe('createSession — event', () => {
    it('copies title/startAt/timezone from the event and checks canWriteAllGroups', async () => {
        const prisma = makePrisma()
        prisma.workspaceEvent.findFirst.mockResolvedValue({
            id: 'e1',
            title: 'Seminar',
            startAt: new Date('2026-07-10T09:00:00Z'),
            timezone: 'Asia/Tomsk',
            coachId: 'c2',
        })
        const rbac = makeRbac()
        await run(prisma, rbac, { kind: 'event', workspaceEventId: 'e1' })
        const data = prisma.attendanceSession.create.mock.calls[0][0].data
        expect(data.occurrenceKey).toBe('event:e1')
        expect(data.timezone).toBe('Asia/Tomsk')
        expect(data.title).toBe('Seminar')
        expect(data.workspaceEventId).toBe('e1')
        expect(rbac.canWriteAllGroups).toHaveBeenCalled()
    })

    it('rejects event attendance for non-admin scope', async () => {
        const prisma = makePrisma()
        const rbac = makeRbac()
        rbac.canWriteAllGroups.mockReturnValue(false)
        await expect(
            run(prisma, rbac, { kind: 'event', workspaceEventId: 'e1' }),
        ).rejects.toThrow(/admin scope/i)
    })
})
