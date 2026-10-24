import { BadRequestError } from '../../shared/errors/shared.errors'
import { CancelDropInFeature } from './cancel-drop-in.feature'
import { CancelDropInHandler } from './cancel-drop-in.handler'

// Saturday 2026-10-24 09:00Z; the slot runs Saturdays 19:00 Tomsk (12:00Z).
const NOW = new Date('2026-10-24T09:00:00Z')

const booking = (sessionDate: string) => ({
    id: 'b1',
    workspaceId: 'w1',
    userId: 'u1',
    groupId: 'g1',
    slotId: 'slot1',
    sessionDate: new Date(`${sessionDate}T00:00:00Z`),
    slot: {
        id: 'slot1',
        dayOfWeek: 6,
        startTime: '19:00',
        durationMin: 90,
        effectiveFrom: null,
        effectiveUntil: null,
    },
    group: {
        name: 'Взрослые',
        gym: { timezone: 'Asia/Tomsk' },
        coaches: [{ userId: 'coach1' }],
    },
})

const makePrisma = () => ({
    dropInBooking: {
        findFirst: jest.fn().mockResolvedValue(booking('2026-10-31')),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
            firstname: 'Ann',
            lastname: null,
            email: 'a@x',
        }),
    },
})

const build = () => {
    const prisma = makePrisma()
    const notifyUser = jest.fn().mockResolvedValue(true)
    const realtime = { invalidate: jest.fn(), invalidateUsers: jest.fn() }
    const handler = new CancelDropInHandler(
        prisma as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (handler: CancelDropInHandler) =>
    handler.execute(new CancelDropInFeature('w1', 'b1', 'u1'))

describe('CancelDropInHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('returns cancelled without deleting when the booking is missing or not the caller\'s', async () => {
        const { handler, prisma } = build()
        prisma.dropInBooking.findFirst.mockResolvedValue(null)
        await expect(run(handler)).resolves.toEqual({ status: 'cancelled' })
        expect(prisma.dropInBooking.findFirst.mock.calls[0][0].where).toEqual({
            id: 'b1',
            workspaceId: 'w1',
            userId: 'u1',
        })
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })

    it('refuses once the class has started', async () => {
        const { handler, prisma } = build()
        prisma.dropInBooking.findFirst.mockResolvedValue(booking('2026-10-24'))
        jest.setSystemTime(new Date('2026-10-24T13:00:00Z'))
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes and tells the coaches', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'cancelled' })
        expect(prisma.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { id: 'b1' },
        })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['u1'], ['dropins'])
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'coach1',
            kind: 'dropin.cancelled',
            refId: 'b1:coach1',
            message: 'Ann не придёт на «Взрослые» 31.10 в 19:00',
        })
    })

    it('deletes a booking for a cancelled class without notifying', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.scheduleException.findMany.mockResolvedValue([
            {
                slotId: null,
                fromDate: new Date('2026-10-31T00:00:00Z'),
                untilDate: new Date('2026-10-31T00:00:00Z'),
                reason: null,
            },
        ])
        await expect(run(handler)).resolves.toEqual({ status: 'cancelled' })
        expect(prisma.dropInBooking.deleteMany).toHaveBeenCalledTimes(1)
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('does not notify when the row was already removed concurrently', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.dropInBooking.deleteMany.mockResolvedValue({ count: 0 })
        await expect(run(handler)).resolves.toEqual({ status: 'cancelled' })
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('one coach\'s failed notification does not skip the next coach', async () => {
        const { handler, prisma, notifyUser } = build()
        const b = booking('2026-10-31')
        prisma.dropInBooking.findFirst.mockResolvedValue({
            ...b,
            group: {
                ...b.group,
                coaches: [{ userId: 'coach1' }, { userId: 'coach2' }],
            },
        })
        notifyUser.mockRejectedValueOnce(new Error('push down'))
        await expect(run(handler)).resolves.toEqual({ status: 'cancelled' })
        expect(notifyUser).toHaveBeenCalledTimes(2)
        expect(notifyUser.mock.calls[1][0].userId).toBe('coach2')
    })
})
