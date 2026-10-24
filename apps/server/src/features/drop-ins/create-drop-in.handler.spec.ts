import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { CreateDropInFeature } from './create-drop-in.feature'
import { CreateDropInHandler } from './create-drop-in.handler'

// Saturday 2026-10-24 09:00Z. The slot runs Saturdays 19:00 in Tomsk (UTC+7),
// i.e. 12:00Z, so today's class is still ahead and next week's is on 10-31.
const NOW = new Date('2026-10-24T09:00:00Z')

const slot = {
    id: 'slot1',
    groupId: 'g1',
    dayOfWeek: 6,
    startTime: '19:00',
    durationMin: 90,
    effectiveFrom: null,
    effectiveUntil: null,
    group: {
        id: 'g1',
        name: 'Взрослые',
        gym: { id: 'gym1', name: 'Зал', address: 'ул. 1', timezone: 'Asia/Tomsk' },
        coach: { firstname: 'Коуч', lastname: null, email: 'c@x' },
        coaches: [{ userId: 'coach1' }, { userId: 'coach2' }],
    },
}

const liveMember = {
    status: 'ACTIVE',
    subscription: {
        id: 'sub1',
        classesRemaining: 1,
        status: 'ACTIVE',
        endDate: new Date('2027-01-01T00:00:00Z'),
    },
}

const makePrisma = () => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({
            timezone: 'Europe/Moscow',
            guestVisitsEnabled: true,
            scheduleEnabled: true,
            subscriptionEnabled: true,
        }),
    },
    workspaceMember: { findUnique: jest.fn().mockResolvedValue(liveMember) },
    groupScheduleSlot: { findFirst: jest.fn().mockResolvedValue(slot) },
    groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
    scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptionFreeze: { findFirst: jest.fn().mockResolvedValue(null) },
    user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
            firstname: 'Ann',
            lastname: null,
            email: 'a@x',
        }),
    },
    dropInBooking: {
        create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
                id: 'b1',
                ...data,
                createdAt: new Date('2026-10-24T09:00:00Z'),
            }),
        ),
        findUniqueOrThrow: jest.fn(),
    },
})

const build = (prisma = makePrisma()) => {
    const notifyUser = jest.fn().mockResolvedValue(true)
    const realtime = { invalidate: jest.fn(), invalidateUsers: jest.fn() }
    const handler = new CreateDropInHandler(
        prisma as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (
    handler: CreateDropInHandler,
    payload = { slotId: 'slot1', sessionDate: '2026-10-31' },
) => handler.execute(new CreateDropInFeature(payload, 'w1', 'u1'))

describe('CreateDropInHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('refuses when guest visits are off in the club', async () => {
        const { handler, prisma } = build()
        prisma.workspace.findUnique.mockResolvedValue({
            timezone: 'Europe/Moscow',
            guestVisitsEnabled: false,
            scheduleEnabled: true,
            subscriptionEnabled: true,
        })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.dropInBooking.create).not.toHaveBeenCalled()
    })

    it('refuses the owner (no member row)', async () => {
        const { handler, prisma } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue(null)
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a suspended member', async () => {
        const { handler, prisma } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            ...liveMember,
            status: 'SUSPENDED',
        })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses an expired pack', async () => {
        const { handler, prisma } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            ...liveMember,
            subscription: {
                ...liveMember.subscription,
                endDate: new Date('2026-10-01T00:00:00Z'),
            },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses a pack with no classes left', async () => {
        const { handler, prisma } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            ...liveMember,
            subscription: { ...liveMember.subscription, classesRemaining: 0 },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('404s on an unknown slot', async () => {
        const { handler, prisma } = build()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue(null)
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses the member\'s own group', async () => {
        const { handler, prisma } = build()
        prisma.groupMember.findFirst.mockResolvedValue({ userId: 'u1' })
        await expect(run(handler)).rejects.toThrow('Это ваша группа')
    })

    it('refuses a coach of the group', async () => {
        const { handler, prisma } = build()
        prisma.groupScheduleSlot.findFirst.mockResolvedValue({
            ...slot,
            group: { ...slot.group, coaches: [{ userId: 'u1' }] },
        })
        await expect(run(handler)).rejects.toThrow('Вы тренер этой группы')
    })

    it('refuses a date the slot does not run', async () => {
        const { handler } = build()
        await expect(
            run(handler, { slotId: 'slot1', sessionDate: '2026-11-01' }),
        ).rejects.toThrow('расписанию нет')
    })

    it('refuses a cancelled class', async () => {
        const { handler, prisma } = build()
        prisma.scheduleException.findMany.mockResolvedValue([
            {
                slotId: null,
                fromDate: new Date('2026-10-31T00:00:00Z'),
                untilDate: new Date('2026-10-31T00:00:00Z'),
                reason: null,
            },
        ])
        await expect(run(handler)).rejects.toThrow('отменена')
    })

    it('refuses a class that already started', async () => {
        const { handler } = build()
        jest.setSystemTime(new Date('2026-10-24T13:00:00Z'))
        await expect(
            run(handler, { slotId: 'slot1', sessionDate: '2026-10-24' }),
        ).rejects.toThrow('уже началась')
    })

    it('refuses a class more than 30 days ahead', async () => {
        const { handler } = build()
        await expect(
            run(handler, { slotId: 'slot1', sessionDate: '2026-12-26' }),
        ).rejects.toThrow('за 30 дней')
    })

    it('refuses while the abonement is frozen on that day', async () => {
        const { handler, prisma } = build()
        prisma.subscriptionFreeze.findFirst.mockResolvedValue({
            untilDate: new Date('2026-11-05T00:00:00Z'),
        })
        await expect(run(handler)).rejects.toThrow(
            'Абонемент заморожен по 5 ноября — записаться нельзя',
        )
        expect(prisma.subscriptionFreeze.findFirst.mock.calls[0][0].where)
            .toMatchObject({ subscriptionId: 'sub1' })
        expect(prisma.dropInBooking.create).not.toHaveBeenCalled()
    })

    it('books, charges nothing and notifies every coach of the group', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler)

        const data = prisma.dropInBooking.create.mock.calls[0][0].data
        expect(data).toEqual({
            workspaceId: 'w1',
            userId: 'u1',
            groupId: 'g1',
            slotId: 'slot1',
            sessionDate: new Date('2026-10-31T00:00:00Z'),
            occurrenceKey: 'slot:slot1:2026-10-31',
        })
        expect(out).toMatchObject({
            id: 'b1',
            groupName: 'Взрослые',
            occurrenceId: 'slot1:2026-10-31',
            sessionDate: '2026-10-31',
            startAt: '2026-10-31T12:00:00.000Z',
            cancelled: false,
        })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['u1'], ['dropins'])
        expect(notifyUser).toHaveBeenCalledTimes(2)
        expect(notifyUser.mock.calls.map((c) => c[0].userId)).toEqual([
            'coach1',
            'coach2',
        ])
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'dropin.booked',
            refId: 'b1:coach1',
            message: 'Ann придёт на «Взрослые» 31.10 в 19:00',
            workspaceId: 'w1',
        })
    })

    it('allows the single-visit pack (one class left)', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.dropInBooking.create).toHaveBeenCalledTimes(1)
    })

    it('P2002 returns the existing booking without notifying again', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.dropInBooking.create.mockRejectedValue({ code: 'P2002' })
        prisma.dropInBooking.findUniqueOrThrow.mockResolvedValue({
            id: 'b0',
            workspaceId: 'w1',
            userId: 'u1',
            groupId: 'g1',
            slotId: 'slot1',
            sessionDate: new Date('2026-10-31T00:00:00Z'),
            occurrenceKey: 'slot:slot1:2026-10-31',
            createdAt: new Date('2026-10-24T08:00:00Z'),
        })
        const out = await run(handler)
        expect(out.id).toBe('b0')
        expect(prisma.dropInBooking.findUniqueOrThrow.mock.calls[0][0].where)
            .toEqual({
                workspaceId_occurrenceKey_userId: {
                    workspaceId: 'w1',
                    occurrenceKey: 'slot:slot1:2026-10-31',
                    userId: 'u1',
                },
            })
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('still resolves when a notification throws', async () => {
        const { handler, notifyUser } = build()
        notifyUser.mockRejectedValue(new Error('push down'))
        await expect(run(handler)).resolves.toMatchObject({ id: 'b1' })
    })
})
