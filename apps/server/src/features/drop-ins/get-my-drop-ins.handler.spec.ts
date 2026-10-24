import { GetMyDropInsFeature } from './get-my-drop-ins.feature'
import { GetMyDropInsHandler } from './get-my-drop-ins.handler'

// Saturday 2026-10-24 13:00Z: today's 10:00 Tomsk class (03:00Z) is over.
const NOW = new Date('2026-10-24T13:00:00Z')

const row = (id: string, sessionDate: string, startTime = '19:00') => ({
    id,
    workspaceId: 'w1',
    userId: 'u1',
    groupId: 'g1',
    slotId: `slot-${id}`,
    sessionDate: new Date(`${sessionDate}T00:00:00Z`),
    createdAt: new Date('2026-10-20T00:00:00Z'),
    slot: {
        id: `slot-${id}`,
        dayOfWeek: 6,
        startTime,
        durationMin: 90,
        effectiveFrom: null,
        effectiveUntil: null,
    },
    group: {
        id: 'g1',
        name: 'Взрослые',
        gym: { id: 'gym1', name: 'Зал', address: 'ул. 1', timezone: 'Asia/Tomsk' },
        coach: { firstname: 'Коуч', lastname: null, email: 'c@x' },
    },
})

const liveMember = {
    status: 'ACTIVE',
    subscription: {
        id: 'sub1',
        classesRemaining: 3,
        status: 'ACTIVE',
        endDate: new Date('2027-01-01T00:00:00Z'),
    },
}

const build = (member: unknown = liveMember, rows: unknown[] = []) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                timezone: 'Europe/Moscow',
                guestVisitsEnabled: true,
                scheduleEnabled: true,
                subscriptionEnabled: true,
            }),
        },
        workspaceMember: { findUnique: jest.fn().mockResolvedValue(member) },
        dropInBooking: { findMany: jest.fn().mockResolvedValue(rows) },
        scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return { prisma, handler: new GetMyDropInsHandler(prisma as never) }
}

const run = (handler: GetMyDropInsHandler) =>
    handler.execute(new GetMyDropInsFeature('w1', 'u1'))

describe('GetMyDropInsHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('canBook with a live pack', async () => {
        const { handler } = build()
        await expect(run(handler)).resolves.toEqual({
            canBook: true,
            blockedReason: null,
            bookings: [],
        })
    })

    it('maps the block reason to its message', async () => {
        const noClasses = build({
            ...liveMember,
            subscription: { ...liveMember.subscription, classesRemaining: 0 },
        })
        expect(await run(noClasses.handler)).toMatchObject({
            canBook: false,
            blockedReason: 'На абонементе не осталось занятий — продлите его у тренера',
        })

        const owner = build(null)
        expect(await run(owner.handler)).toMatchObject({
            canBook: false,
            blockedReason: 'Запись в другие группы доступна участникам клуба',
        })
    })

    it('drops past bookings and sorts the rest by start', async () => {
        const { handler } = build(liveMember, [
            row('late', '2026-11-07'),
            row('past', '2026-10-24', '10:00'),
            row('soon', '2026-10-31'),
        ])
        const out = await run(handler)
        expect(out.bookings.map((b) => b.id)).toEqual(['soon', 'late'])
    })

    it('flags a booking whose class was cancelled', async () => {
        const { handler, prisma } = build(liveMember, [row('x', '2026-10-31')])
        prisma.scheduleException.findMany.mockResolvedValue([
            {
                groupId: 'g1',
                slotId: null,
                fromDate: new Date('2026-10-31T00:00:00Z'),
                untilDate: new Date('2026-10-31T00:00:00Z'),
                reason: null,
            },
        ])
        const out = await run(handler)
        expect(out.bookings[0].cancelled).toBe(true)
    })
})
