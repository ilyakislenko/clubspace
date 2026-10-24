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
