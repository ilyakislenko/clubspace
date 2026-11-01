import { GetWorkspaceScheduleFeature } from './get-workspace-schedule.feature'
import { GetWorkspaceScheduleHandler } from './get-workspace-schedule.handler'

// 2026-10-31 is a Saturday (ISO 6).
const group = {
    id: 'g1',
    name: 'Взрослые',
    gym: null,
    coach: { id: 'c1', email: 'c@x', firstname: null, lastname: null },
    slots: [
        {
            id: 'slot1',
            dayOfWeek: 6,
            startTime: '19:00',
            durationMin: 90,
            effectiveFrom: null,
            effectiveUntil: null,
        },
        {
            id: 'slot2',
            dayOfWeek: 6,
            startTime: '10:00',
            durationMin: 60,
            effectiveFrom: null,
            effectiveUntil: null,
        },
    ],
    exceptions: [],
}

type Booking = { occurrenceKey: string; groupId: string; userId: string }

const build = (bookings: Booking[], ownMembers: { groupId: string; userId: string }[] = []) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'w1', timezone: 'Europe/Moscow' }),
        },
        group: { findMany: jest.fn().mockResolvedValue([group]) },
        workspaceEvent: { findMany: jest.fn().mockResolvedValue([]) },
        dropInBooking: { findMany: jest.fn().mockResolvedValue(bookings) },
        groupMember: { findMany: jest.fn().mockResolvedValue(ownMembers) },
        classSubstitution: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return { prisma, handler: new GetWorkspaceScheduleHandler(prisma as never) }
}

const KEY = 'slot:slot1:2026-10-31'
const run = (handler: GetWorkspaceScheduleHandler) =>
    handler.execute(
        new GetWorkspaceScheduleFeature(
            { from: '2026-10-31', to: '2026-10-31' },
            'w1',
        ),
    )

describe('GetWorkspaceScheduleHandler — bookedGuests', () => {
    it('counts bookings per occurrence key, 0 by default, active members only', async () => {
        const { handler, prisma } = build([
            { occurrenceKey: KEY, groupId: 'g1', userId: 'u1' },
            { occurrenceKey: KEY, groupId: 'g1', userId: 'u2' },
            { occurrenceKey: KEY, groupId: 'g1', userId: 'u3' },
        ])
        const out = await run(handler)
        expect(
            out.sessions.map((s) => [s.slotId, s.bookedGuests]),
        ).toEqual([
            ['slot2', 0],
            ['slot1', 3],
        ])
        expect(prisma.dropInBooking.findMany).toHaveBeenCalledWith({
            where: {
                workspaceId: 'w1',
                sessionDate: {
                    gte: new Date('2026-10-31T00:00:00Z'),
                    lte: new Date('2026-10-31T00:00:00Z'),
                },
                user: {
                    workspaceMemberships: {
                        some: { workspaceId: 'w1', status: 'ACTIVE' },
                    },
                },
            },
            select: { occurrenceKey: true, groupId: true, userId: true },
        })
    })

    it('does not count a booker who has since joined the class group', async () => {
        const { handler } = build(
            [
                { occurrenceKey: KEY, groupId: 'g1', userId: 'u1' },
                { occurrenceKey: KEY, groupId: 'g1', userId: 'u2' },
            ],
            [{ groupId: 'g1', userId: 'u2' }],
        )
        const out = await run(handler)
        expect(
            out.sessions.find((s) => s.slotId === 'slot1')?.bookedGuests,
        ).toBe(1)
    })
})

describe('GetWorkspaceScheduleHandler — substitution', () => {
    it('attaches the occurrence’s substitution, null elsewhere', async () => {
        const { handler, prisma } = build([])
        const substitute = { id: 'c2', email: 'c2@x.ru', firstname: 'Олег', lastname: 'Петров' }
        prisma.classSubstitution.findMany.mockResolvedValue([
            {
                id: 'sub1',
                occurrenceKey: KEY,
                status: 'APPROVED',
                kind: 'ASSIGN',
                requestedById: 'c1',
                substitute,
            },
        ])
        const out = await run(handler)
        expect(prisma.classSubstitution.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            sessionDate: {
                gte: new Date('2026-10-31T00:00:00Z'),
                lte: new Date('2026-10-31T00:00:00Z'),
            },
        })
        const bySlot = new Map(out.sessions.map((s) => [s.slotId, s.substitution]))
        expect(bySlot.get('slot1')).toEqual({
            id: 'sub1',
            status: 'APPROVED',
            kind: 'ASSIGN',
            requestedById: 'c1',
            substitute,
        })
        expect(bySlot.get('slot2')).toBeNull()
    })
})

describe('GetWorkspaceScheduleHandler — moved classes', () => {
    // slot1's Saturday class moved to Sunday 2026-11-01 12:00 (a one-off),
    // leaving a cancelled ghost on 2026-10-31 that points at it.
    const movedGroup = {
        ...group,
        slots: [
            group.slots[0],
            {
                id: 'one-off',
                dayOfWeek: 7,
                startTime: '12:00',
                durationMin: 90,
                effectiveFrom: new Date('2026-11-01T00:00:00Z'),
                effectiveUntil: new Date('2026-11-01T00:00:00Z'),
                movedFromSlotId: 'slot1',
                movedFromDate: new Date('2026-10-31T00:00:00Z'),
            },
            {
                id: 'orphan',
                dayOfWeek: 7,
                startTime: '15:00',
                durationMin: 60,
                effectiveFrom: new Date('2026-11-01T00:00:00Z'),
                effectiveUntil: new Date('2026-11-01T00:00:00Z'),
                // The origin slot was deleted (SetNull).
                movedFromSlotId: null,
                movedFromDate: new Date('2026-10-24T00:00:00Z'),
            },
        ],
        exceptions: [
            {
                slotId: 'slot1',
                fromDate: new Date('2026-10-31T00:00:00Z'),
                untilDate: new Date('2026-10-31T00:00:00Z'),
                reason: 'Перенесено на 01.11 в 12:00',
                movedToSlotId: 'one-off',
            },
        ],
    }

    it('marks one-offs, where a moved class came from and where its ghost went', async () => {
        const { handler, prisma } = build([])
        prisma.group.findMany.mockResolvedValue([movedGroup])
        const out = await handler.execute(
            new GetWorkspaceScheduleFeature(
                { from: '2026-10-31', to: '2026-11-01' },
                'w1',
            ),
        )
        const bySlot = new Map(out.sessions.map((s) => [s.slotId, s]))
        expect(bySlot.get('slot1')).toMatchObject({
            cancelled: true,
            recurring: true,
            rescheduledFrom: null,
            rescheduledTo: {
                slotId: 'one-off',
                sessionDate: '2026-11-01',
                startAt: '2026-11-01T09:00:00.000Z',
            },
        })
        expect(bySlot.get('one-off')).toMatchObject({
            cancelled: false,
            recurring: false,
            rescheduledFrom: {
                sessionDate: '2026-10-31',
                startAt: '2026-10-31T16:00:00.000Z',
            },
            rescheduledTo: null,
        })
        expect(bySlot.get('orphan')).toMatchObject({
            recurring: false,
            rescheduledFrom: null,
        })
    })
})
