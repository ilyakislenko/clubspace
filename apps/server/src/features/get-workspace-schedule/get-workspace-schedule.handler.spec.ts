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

const build = (counts: { occurrenceKey: string; _count: { _all: number } }[]) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'w1', timezone: 'Europe/Moscow' }),
        },
        group: { findMany: jest.fn().mockResolvedValue([group]) },
        workspaceEvent: { findMany: jest.fn().mockResolvedValue([]) },
        dropInBooking: { groupBy: jest.fn().mockResolvedValue(counts) },
    }
    return { prisma, handler: new GetWorkspaceScheduleHandler(prisma as never) }
}

describe('GetWorkspaceScheduleHandler — bookedGuests', () => {
    it('maps drop-in counts by occurrence key, 0 by default', async () => {
        const { handler, prisma } = build([
            { occurrenceKey: 'slot:slot1:2026-10-31', _count: { _all: 3 } },
        ])
        const out = await handler.execute(
            new GetWorkspaceScheduleFeature(
                { from: '2026-10-31', to: '2026-10-31' },
                'w1',
            ),
        )
        expect(
            out.sessions.map((s) => [s.slotId, s.bookedGuests]),
        ).toEqual([
            ['slot2', 0],
            ['slot1', 3],
        ])
        expect(prisma.dropInBooking.groupBy).toHaveBeenCalledWith({
            by: ['occurrenceKey'],
            where: {
                workspaceId: 'w1',
                sessionDate: {
                    gte: new Date('2026-10-31T00:00:00Z'),
                    lte: new Date('2026-10-31T00:00:00Z'),
                },
            },
            _count: { _all: true },
        })
    })
})
