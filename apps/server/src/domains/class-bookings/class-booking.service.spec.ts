import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ClassBookingService } from './class-booking.service'

// 2026-11-10 is a Tuesday (ISO 2). The slot runs 19:00 Moscow = 16:00 UTC.
const DATE = '2026-11-10'
const START = new Date('2026-11-10T16:00:00Z')
const END = new Date('2026-11-10T17:00:00Z')
const BEFORE = new Date('2026-11-08T10:00:00Z') // two days before: free cancel
const LATE = new Date('2026-11-10T10:00:00Z') // six hours before: past the 12 h deadline

const slotRow = (over: Record<string, unknown> = {}) => ({
    id: 'slot-1',
    dayOfWeek: 2,
    startTime: '19:00',
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
    capacity: null,
    group: {
        id: 'group-1',
        name: 'Пилон',
        workspaceId: 'ws-1',
        directionId: null,
        bookingMode: 'BOOKING',
        capacity: 1,
        bookingWindowDays: null,
        bookingCancelHours: null,
        gym: null,
        coach: { firstname: 'Анна', lastname: 'Тренер', email: null },
        coaches: [{ userId: 'coach-1' }],
        ...((over.group as object) ?? {}),
    },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'group')),
})

const booking = (over: Record<string, unknown> = {}) => ({
    id: 'b-1',
    occurrenceId: 'occ-1',
    userId: 'user-1',
    status: 'BOOKED',
    bookedById: 'user-1',
    overCapacity: false,
    promotedAt: null,
    cancelledAt: null,
    classBurned: false,
    burnedSubscriptionId: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
})

const pack = (over: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    status: 'ACTIVE',
    startDate: new Date('2026-11-01T00:00:00Z'),
    endDate: new Date('2026-12-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    classesTotal: 8,
    classesRemaining: 5,
    startsOnFirstVisit: false,
    plan: { name: '8 занятий' },
    workspaceMember: { userId: 'user-1' },
    directions: [],
    freezes: [],
    ...over,
})

const makePrisma = () => {
    const prisma = {
        groupScheduleSlot: { findFirst: jest.fn().mockResolvedValue(slotRow()) },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                timezone: 'Europe/Moscow',
                subscriptionEnabled: true,
                bookingWindowDays: 14,
                bookingCancelHours: 12,
                bookingLateCancelBurn: true,
                bookingNoShowBurn: true,
            }),
        },
        scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
        workspaceMember: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        classOccurrence: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'occ-1' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'occ-1' }),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
        },
        classBooking: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            findUniqueOrThrow: jest.fn(),
            create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve(booking({ id: 'b-new', ...data })),
            ),
            update: jest.fn().mockImplementation(({ where, data }) =>
                Promise.resolve(booking({ id: where.id, ...data })),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        subscription: {
            findMany: jest.fn().mockResolvedValue([pack()]),
            findUnique: jest.fn().mockResolvedValue({ plan: { name: '8 занятий' } }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
        attendanceSession: { findUnique: jest.fn().mockResolvedValue(null) },
        $queryRaw: jest.fn().mockResolvedValue([
            { capacity: null, settledAt: null, startAt: START, endAt: END },
        ]),
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
    return prisma
}

const setup = () => {
    const prisma = makePrisma()
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = {
        invalidate: jest.fn(),
        invalidateUsersInWorkspace: jest.fn(),
    }
    const service = new ClassBookingService(
        prisma as never,
        notifications as never,
        realtime as never,
    )
    return { prisma, notifications, realtime, service }
}

const bookArgs = (now: Date) => ({
    workspaceId: 'ws-1',
    userId: 'user-1',
    actorId: 'user-1',
    slotId: 'slot-1',
    sessionDate: DATE,
    now,
})

describe('ClassBookingService.book', () => {
    it('takes a free place under the class lock', async () => {
        const { prisma, service, realtime } = setup()
        const res = await service.book(bookArgs(BEFORE))
        expect(res).toMatchObject({
            status: 'BOOKED',
            occurrenceId: `slot-1:${DATE}`,
            startAt: START.toISOString(),
            waitlistPosition: null,
            lateCancelNow: false,
        })
        expect(prisma.$queryRaw).toHaveBeenCalled()
        expect(prisma.classOccurrence.create.mock.calls[0][0].data).toMatchObject({
            occurrenceKey: `slot:slot-1:${DATE}`,
            startAt: START,
        })
        expect(realtime.invalidate).toHaveBeenCalled()
    })

    it('waitlists when the class is full', async () => {
        const { prisma, service } = setup()
        prisma.classBooking.findMany
            .mockResolvedValueOnce([]) // held elsewhere (abonement check)
            .mockResolvedValueOnce([booking({ userId: 'other' })]) // under the lock
            .mockResolvedValueOnce([
                { id: 'b-new', status: 'WAITLISTED', createdAt: new Date() },
            ]) // queue for the position
        const res = await service.book(bookArgs(BEFORE))
        expect(res).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 })
    })

    it('returns the place the member already holds', async () => {
        const { prisma, service } = setup()
        prisma.classOccurrence.findUnique.mockResolvedValue({
            id: 'occ-1',
            capacity: null,
            settledAt: null,
        })
        prisma.classBooking.findFirst.mockResolvedValue(booking())
        const res = await service.book(bookArgs(BEFORE))
        expect(res.id).toBe('b-1')
        expect(prisma.classBooking.create).not.toHaveBeenCalled()
    })

    it('refuses a fixed group, a started class, a closed window, a cancelled class', async () => {
        const fixed = setup()
        fixed.prisma.groupScheduleSlot.findFirst.mockResolvedValue(
            slotRow({ group: { bookingMode: 'FIXED' } }),
        )
        await expect(fixed.service.book(bookArgs(BEFORE))).rejects.toThrow(
            /постоянным составом/,
        )
        const { service, prisma } = setup()
        await expect(service.book(bookArgs(new Date(START.getTime() + 1)))).rejects.toThrow(
            /уже началось/,
        )
        await expect(
            service.book(bookArgs(new Date('2026-10-20T10:00:00Z'))),
        ).rejects.toThrow(/откроется 27 октября/)
        prisma.scheduleException.findMany.mockResolvedValue([
            {
                slotId: null,
                fromDate: new Date(`${DATE}T00:00:00Z`),
                untilDate: new Date(`${DATE}T00:00:00Z`),
                reason: null,
            },
        ])
        await expect(service.book(bookArgs(BEFORE))).rejects.toThrow(/отменено/)
        await expect(
            service.book({ ...bookArgs(BEFORE), sessionDate: '2026-11-11' }),
        ).rejects.toThrow(/нет/)
    })

    it('refuses the coach, a non-member, a paused member, a missing class', async () => {
        const { service, prisma } = setup()
        await expect(
            service.book({ ...bookArgs(BEFORE), userId: 'coach-1' }),
        ).rejects.toThrow(/тренер/)
        prisma.workspaceMember.findUnique.mockResolvedValueOnce(null)
        await expect(service.book(bookArgs(BEFORE))).rejects.toBeInstanceOf(ForbiddenError)
        prisma.workspaceMember.findUnique.mockResolvedValueOnce({ status: 'BLOCKED' })
        await expect(service.book(bookArgs(BEFORE))).rejects.toThrow(/приостановлено/)
        prisma.groupScheduleSlot.findFirst.mockResolvedValueOnce(null)
        await expect(service.book(bookArgs(BEFORE))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('needs an abonement that may pay for the class', async () => {
        const { service, prisma } = setup()
        prisma.subscription.findMany.mockResolvedValue([])
        await expect(service.book(bookArgs(BEFORE))).rejects.toThrow(/Нет абонемента/)
        prisma.subscription.findMany.mockResolvedValue([pack({ classesRemaining: 1 })])
        prisma.classBooking.findMany.mockResolvedValueOnce([
            { occurrence: { group: { directionId: null } } },
        ])
        await expect(service.book(bookArgs(BEFORE))).rejects.toThrow(/распределены/)
        expect(prisma.classBooking.create).not.toHaveBeenCalled()
    })

    it('books without an abonement in a club that does not use them', async () => {
        const { service, prisma } = setup()
        prisma.workspace.findUnique.mockResolvedValue({
            timezone: 'Europe/Moscow',
            subscriptionEnabled: false,
            bookingWindowDays: 14,
            bookingCancelHours: 12,
            bookingLateCancelBurn: true,
            bookingNoShowBurn: true,
        })
        prisma.subscription.findMany.mockResolvedValue([])
        await expect(service.book(bookArgs(BEFORE))).resolves.toMatchObject({
            status: 'BOOKED',
        })
    })

    it('reads an occurrence created by a concurrent first booking', async () => {
        const { service, prisma } = setup()
        prisma.classOccurrence.create.mockRejectedValueOnce({ code: 'P2002' })
        await service.book(bookArgs(BEFORE))
        expect(prisma.classOccurrence.findUniqueOrThrow).toHaveBeenCalled()
        prisma.classOccurrence.create.mockRejectedValueOnce(new Error('boom'))
        await expect(service.book(bookArgs(BEFORE))).rejects.toThrow('boom')
    })
})

describe('ClassBookingService.cancelOwn', () => {
    const owned = (status = 'BOOKED', over: Record<string, unknown> = {}) =>
        booking({
            status,
            occurrence: { slotId: 'slot-1', sessionDate: new Date(`${DATE}T00:00:00Z`) },
            ...over,
        })
    const args = (now: Date) => ({
        workspaceId: 'ws-1',
        userId: 'user-1',
        bookingId: 'b-1',
        now,
    })

    it('cancels in time without a burn and promotes the waitlist (pushing once)', async () => {
        const { service, prisma, notifications } = setup()
        prisma.classBooking.findFirst.mockResolvedValue(owned())
        prisma.classBooking.findUniqueOrThrow.mockResolvedValue(owned())
        prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'b-2', userId: 'user-2', status: 'WAITLISTED' },
            { id: 'b-3', userId: 'user-3', status: 'WAITLISTED' },
        ])
        prisma.$queryRaw.mockResolvedValue([
            { capacity: null, settledAt: null, startAt: START, endAt: END },
        ])
        const res = await service.cancelOwn(args(BEFORE))
        expect(res).toMatchObject({ status: 'CANCELLED', classBurned: false })
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
        // Capacity 1: only the first in the queue moves up.
        expect(prisma.classBooking.updateMany).toHaveBeenCalledTimes(1)
        expect(prisma.classBooking.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: 'b-2', status: 'WAITLISTED' },
            data: { status: 'BOOKED', promotedAt: BEFORE },
        })
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'user-2',
            kind: 'classbooking.promoted',
            refId: 'b-2',
        })
    })

    it('a late cancel burns a class from the abonement a visit would use', async () => {
        const { service, prisma } = setup()
        prisma.classBooking.findFirst.mockResolvedValue(owned())
        prisma.classBooking.findUniqueOrThrow.mockResolvedValue(owned())
        const res = await service.cancelOwn(args(LATE))
        expect(res).toMatchObject({
            status: 'LATE_CANCELLED',
            classBurned: true,
            burnedPlanName: '8 занятий',
        })
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 'sub-1', classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
        })
    })

    it('a late cancel on a time-based abonement records it and burns nothing', async () => {
        const { service, prisma } = setup()
        prisma.subscription.findMany.mockResolvedValue([
            pack({ classesTotal: null, classesRemaining: null }),
        ])
        prisma.classBooking.findFirst.mockResolvedValue(owned())
        prisma.classBooking.findUniqueOrThrow.mockResolvedValue(owned())
        const res = await service.cancelOwn(args(LATE))
        expect(res).toMatchObject({ status: 'LATE_CANCELLED', classBurned: false })
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('a waitlist place given up late is never a late cancel', async () => {
        const { service, prisma } = setup()
        prisma.classBooking.findFirst.mockResolvedValue(owned('WAITLISTED'))
        prisma.classBooking.findUniqueOrThrow.mockResolvedValue(owned('WAITLISTED'))
        const res = await service.cancelOwn(args(LATE))
        expect(res.status).toBe('CANCELLED')
    })

    it('is a no-op for a closed booking and refused once the class started', async () => {
        const { service, prisma } = setup()
        prisma.classBooking.findFirst.mockResolvedValue(owned('CANCELLED'))
        await expect(service.cancelOwn(args(BEFORE))).resolves.toMatchObject({
            status: 'CANCELLED',
        })
        prisma.classBooking.findFirst.mockResolvedValue(owned())
        await expect(service.cancelOwn(args(START))).rejects.toBeInstanceOf(BadRequestError)
        prisma.classBooking.findFirst.mockResolvedValue(null)
        await expect(service.cancelOwn(args(BEFORE))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a booking released meanwhile is returned as it is', async () => {
        const { service, prisma } = setup()
        prisma.classBooking.findFirst.mockResolvedValue(owned())
        prisma.classBooking.findUniqueOrThrow.mockResolvedValue(owned('CANCELLED'))
        const res = await service.cancelOwn(args(BEFORE))
        expect(res.status).toBe('CANCELLED')
        expect(prisma.classBooking.update).not.toHaveBeenCalled()
    })
})

describe('ClassBookingService staff actions', () => {
    const loaded = async (s: ReturnType<typeof setup>) =>
        s.service.loadClass('ws-1', 'slot-1', DATE)

    it('adds a member over the capacity and tells them', async () => {
        const s = setup()
        const cls = await loaded(s)
        s.prisma.classBooking.findMany.mockResolvedValueOnce([booking({ userId: 'other' })])
        await s.service.addByStaff({ cls, userId: 'user-9', actorId: 'coach-1', now: BEFORE })
        expect(s.prisma.classBooking.create.mock.calls[0][0].data).toMatchObject({
            userId: 'user-9',
            status: 'BOOKED',
            overCapacity: true,
            bookedById: 'coach-1',
        })
        expect(s.notifications.notifyUser.mock.calls[0][0].kind).toBe('classbooking.added')
    })

    it('moves a waitlisted member to a place; a booked one stays as is', async () => {
        const s = setup()
        const cls = await loaded(s)
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            booking({ id: 'w', userId: 'user-9', status: 'WAITLISTED' }),
        ])
        await s.service.addByStaff({ cls, userId: 'user-9', actorId: 'coach-1', now: BEFORE })
        expect(s.prisma.classBooking.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'w' },
            data: { status: 'BOOKED', overCapacity: false },
        })
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            booking({ userId: 'user-9' }),
        ])
        s.notifications.notifyUser.mockClear()
        await s.service.addByStaff({ cls, userId: 'user-9', actorId: 'coach-1', now: BEFORE })
        expect(s.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('refuses a non-member, a finished class, a fixed group', async () => {
        const s = setup()
        const cls = await loaded(s)
        s.prisma.workspaceMember.findUnique.mockResolvedValueOnce(null)
        await expect(
            s.service.addByStaff({ cls, userId: 'x', actorId: 'c', now: BEFORE }),
        ).rejects.toThrow(/не состоит/)
        await expect(
            s.service.addByStaff({ cls, userId: 'x', actorId: 'c', now: END }),
        ).rejects.toThrow(/закончилось/)
        s.prisma.groupScheduleSlot.findFirst.mockResolvedValue(
            slotRow({ group: { bookingMode: 'FIXED' } }),
        )
        const fixed = await loaded(s)
        await expect(
            s.service.addByStaff({ cls: fixed, userId: 'x', actorId: 'c', now: BEFORE }),
        ).rejects.toThrow(/постоянным составом/)
        await expect(
            s.service.setOccurrenceCapacity({ cls: fixed, capacity: 3 }),
        ).rejects.toThrow(/Места/)
    })

    it('removes a booking without a burn', async () => {
        const s = setup()
        const cls = await loaded(s)
        s.prisma.classBooking.findFirst.mockResolvedValue({
            id: 'b-1',
            occurrenceId: 'occ-1',
            status: 'BOOKED',
            userId: 'user-1',
        })
        s.prisma.classBooking.findUniqueOrThrow.mockResolvedValue(booking())
        await s.service.removeByStaff({ cls, bookingId: 'b-1', now: LATE })
        expect(s.prisma.classBooking.update.mock.calls[0][0].data).toMatchObject({
            status: 'CANCELLED',
            classBurned: false,
        })
        expect(s.prisma.subscription.updateMany).not.toHaveBeenCalled()
        s.prisma.classBooking.findFirst.mockResolvedValue(null)
        await expect(
            s.service.removeByStaff({ cls, bookingId: 'nope' }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a raised date capacity promotes from the waitlist', async () => {
        const s = setup()
        const cls = await loaded(s)
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'b-1', userId: 'user-1', status: 'BOOKED' },
            { id: 'b-2', userId: 'user-2', status: 'WAITLISTED' },
        ])
        await s.service.setOccurrenceCapacity({ cls, capacity: 2, now: BEFORE })
        expect(s.prisma.classOccurrence.update).toHaveBeenCalledWith({
            where: { id: 'occ-1' },
            data: { capacity: 2 },
        })
        expect(s.notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'user-2',
            kind: 'classbooking.promoted',
        })
    })
})

describe('ClassBookingService club cancellations and the sweep', () => {
    const occurrence = {
        id: 'occ-1',
        workspaceId: 'ws-1',
        slotId: 'slot-1',
        sessionDate: new Date(`${DATE}T00:00:00Z`),
    }

    it('a club cancellation closes live bookings and pushes their members', async () => {
        const s = setup()
        s.prisma.classOccurrence.findMany.mockResolvedValue([occurrence])
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'b-1', userId: 'user-1' },
            { id: 'b-2', userId: 'user-2' },
        ])
        const n = await s.service.cancelByClub({
            workspaceId: 'ws-1',
            groupId: 'group-1',
            slotId: 'slot-1',
            fromDate: occurrence.sessionDate,
            untilDate: occurrence.sessionDate,
            reason: 'Ремонт',
            now: BEFORE,
        })
        expect(n).toBe(2)
        expect(s.prisma.classBooking.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: { in: ['b-1', 'b-2'] } },
            data: { status: 'CANCELLED_BY_CLUB' },
        })
        expect(s.notifications.notifyUser).toHaveBeenCalledTimes(2)
        expect(s.notifications.notifyUser.mock.calls[0][0].message).toContain('Ремонт')
        expect(s.prisma.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('settles a finished class: attended, no-show with a burn, expired waitlist', async () => {
        const s = setup()
        s.prisma.classOccurrence.findMany
            .mockResolvedValueOnce([]) // nothing to promote
            .mockResolvedValueOnce([occurrence]) // due
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'a', userId: 'present', status: 'BOOKED' },
            { id: 'n', userId: 'user-1', status: 'BOOKED' },
            { id: 'w', userId: 'late', status: 'WAITLISTED' },
        ])
        s.prisma.attendanceSession.findUnique.mockResolvedValue({
            records: [{ userId: 'present' }],
        })
        const res = await s.service.sweep(new Date(END.getTime() + 3 * 3_600_000))
        expect(res).toEqual({ promoted: 0, settled: 1 })
        const calls = s.prisma.classBooking.updateMany.mock.calls.map((c) => c[0])
        expect(calls).toEqual(
            expect.arrayContaining([
                { where: { id: { in: ['a'] } }, data: { status: 'ATTENDED' } },
                { where: { id: { in: ['w'] } }, data: { status: 'EXPIRED' } },
            ]),
        )
        expect(s.prisma.classBooking.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'n' },
            data: { status: 'NO_SHOW', classBurned: true, burnedSubscriptionId: 'sub-1' },
        })
        expect(s.notifications.notifyUser.mock.calls[0][0].kind).toBe('classbooking.noshow')
        expect(s.prisma.classOccurrence.update).toHaveBeenCalledWith({
            where: { id: 'occ-1' },
            data: { settledAt: expect.any(Date) },
        })
    })

    it('settles a class the club cancelled without burning, and skips a settled one', async () => {
        const s = setup()
        s.prisma.scheduleException.findMany.mockResolvedValue([
            {
                slotId: 'slot-1',
                fromDate: occurrence.sessionDate,
                untilDate: occurrence.sessionDate,
                reason: null,
            },
        ])
        s.prisma.classOccurrence.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([occurrence])
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'n', userId: 'user-1', status: 'BOOKED' },
        ])
        await s.service.sweep(new Date(END.getTime() + 3 * 3_600_000))
        expect(s.prisma.classBooking.updateMany.mock.calls[0][0].data.status).toBe(
            'CANCELLED_BY_CLUB',
        )
        expect(s.prisma.subscription.updateMany).not.toHaveBeenCalled()

        const again = setup()
        again.prisma.classOccurrence.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([occurrence])
        again.prisma.$queryRaw.mockResolvedValue([
            { capacity: null, settledAt: new Date(), startAt: START, endAt: END },
        ])
        await expect(
            again.service.sweep(new Date(END.getTime() + 3 * 3_600_000)),
        ).resolves.toEqual({ promoted: 0, settled: 0 })
    })

    it('promotes waitlists of future classes with free places, logging failures', async () => {
        const s = setup()
        s.prisma.classOccurrence.findMany
            .mockResolvedValueOnce([occurrence, { ...occurrence, id: 'occ-2' }])
            .mockResolvedValueOnce([])
        s.prisma.classBooking.findMany.mockResolvedValueOnce([
            { id: 'w', userId: 'user-2', status: 'WAITLISTED' },
        ])
        s.prisma.$queryRaw
            .mockResolvedValueOnce([{ capacity: null, settledAt: null, startAt: START, endAt: END }])
            .mockRejectedValueOnce(new Error('lock timeout'))
        const res = await s.service.sweep(BEFORE)
        expect(res).toEqual({ promoted: 1, settled: 0 })
    })
})
