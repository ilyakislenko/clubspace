import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddClassBookingFeature } from './add-class-booking.feature'
import { AddClassBookingHandler } from './add-class-booking.handler'
import { BookClassFeature } from './book-class.feature'
import { BookClassHandler } from './book-class.handler'
import { CancelClassBookingFeature } from './cancel-class-booking.feature'
import { CancelClassBookingHandler } from './cancel-class-booking.handler'
import { GetClassOccurrenceFeature } from './get-class-occurrence.feature'
import { GetClassOccurrenceHandler } from './get-class-occurrence.handler'
import { GetMyClassBookingsFeature } from './get-my-class-bookings.feature'
import { GetMyClassBookingsHandler } from './get-my-class-bookings.handler'
import { RemoveClassBookingFeature } from './remove-class-booking.feature'
import { RemoveClassBookingHandler } from './remove-class-booking.handler'
import { SetClassCapacityFeature } from './set-class-capacity.feature'
import { SetClassCapacityHandler } from './set-class-capacity.handler'

const START = new Date('2026-11-10T16:00:00Z')
const END = new Date('2026-11-10T17:00:00Z')
const params = { slotId: '11111111-1111-4111-8111-111111111111', sessionDate: '2026-11-10' }

const loadedClass = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    occurrenceKey: `slot:${params.slotId}:${params.sessionDate}`,
    sessionDate: params.sessionDate,
    slot: { id: params.slotId, capacity: null },
    group: {
        id: 'group-1',
        name: 'Пилон',
        capacity: 8,
        gym: null,
        coach: { firstname: 'Анна', lastname: null, email: null },
    },
    occ: { scheduled: true, cancelled: false, startAt: START, endAt: END, timezone: 'Europe/Moscow' },
    settings: { windowDays: 14, cancelHours: 12, lateCancelBurn: true, noShowBurn: true },
    ...over,
})

const row = (over: Record<string, unknown>) => ({
    id: 'b',
    userId: 'u',
    status: 'BOOKED',
    bookedById: 'u',
    overCapacity: false,
    promotedAt: null,
    cancelledAt: null,
    classBurned: false,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    user: { firstname: 'Ира', lastname: null, email: null },
    burnedSubscription: null,
    ...over,
})

const build = (scope: 'admin' | 'coach_own_only' | 'coach_read_all' = 'admin') => {
    const prisma = {
        classOccurrence: {
            findUnique: jest.fn().mockResolvedValue({
                capacity: null,
                settledAt: null,
                bookings: [
                    row({ id: 'w2', userId: 'u3', status: 'WAITLISTED', createdAt: new Date('2026-11-03T00:00:00Z') }),
                    row({ id: 'w1', userId: 'u2', status: 'WAITLISTED', createdAt: new Date('2026-11-02T00:00:00Z') }),
                    row({ id: 'c', userId: 'u4', status: 'LATE_CANCELLED', classBurned: true, burnedSubscription: { plan: { name: '8 занятий' } } }),
                    row({ id: 'b1', userId: 'u1', bookedById: 'coach-1', overCapacity: true }),
                ],
            }),
        },
        attendanceSession: {
            findUnique: jest.fn().mockResolvedValue({ records: [{ userId: 'u1' }] }),
        },
        classBooking: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope, userId: 'coach-1' }),
        canSeeAllGroups: jest.fn(() => scope !== 'coach_own_only'),
        assertCanWriteGroup: jest.fn().mockResolvedValue('coach'),
    }
    const classBookings = {
        loadClass: jest.fn().mockResolvedValue(loadedClass()),
        book: jest.fn().mockResolvedValue({ id: 'new' }),
        cancelOwn: jest.fn().mockResolvedValue({ id: 'b1', status: 'CANCELLED' }),
        addByStaff: jest.fn().mockResolvedValue(undefined),
        removeByStaff: jest.fn().mockResolvedValue(undefined),
        setOccurrenceCapacity: jest.fn().mockResolvedValue(undefined),
        view: jest.fn(async (_cls: unknown, b: { id: string; status: string }) => ({
            id: b.id,
            status: b.status,
        })),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return { prisma, rbac, classBookings, audit }
}

const staff = [params, 'ws-1', 'coach-1', 'coach', false] as const

describe('member class-booking handlers', () => {
    it('book: the place is for the member (the child under act-as), written by the actor', async () => {
        const { classBookings } = build()
        await new BookClassHandler(classBookings as never).execute(
            new BookClassFeature(params, 'ws-1', 'child-1', 'parent-1'),
        )
        expect(classBookings.book).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'child-1',
            actorId: 'parent-1',
            slotId: params.slotId,
            sessionDate: params.sessionDate,
        })
    })

    it('cancel: only the invoker’s own booking is passed on', async () => {
        const { classBookings } = build()
        await new CancelClassBookingHandler(classBookings as never).execute(
            new CancelClassBookingFeature('ws-1', 'b1', 'user-1'),
        )
        expect(classBookings.cancelOwn).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'user-1',
            bookingId: 'b1',
        })
        classBookings.cancelOwn.mockRejectedValueOnce(new NotFoundError({ message: 'x' }))
        await expect(
            new CancelClassBookingHandler(classBookings as never).execute(
                new CancelClassBookingFeature('ws-1', 'b9', 'user-1'),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('mine: live bookings of classes not over are upcoming, the rest history (newest first)', async () => {
        const { classBookings } = build()
        const later = loadedClass({ occ: { ...loadedClass().occ, endAt: new Date(Date.now() + 86_400_000) } })
        const past = loadedClass({ occ: { ...loadedClass().occ, endAt: new Date(Date.now() - 86_400_000) } })
        classBookings.loadClass
            .mockResolvedValueOnce(past)
            .mockResolvedValueOnce(later)
        const day = (d: string) => ({ slotId: params.slotId, sessionDate: new Date(`${d}T00:00:00Z`) })
        const prisma = {
            classBooking: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'old', status: 'NO_SHOW', occurrence: day('2026-10-01') },
                    { id: 'old-2', status: 'BOOKED', occurrence: day('2026-10-01') },
                    { id: 'next', status: 'WAITLISTED', occurrence: day('2026-12-01') },
                    { id: 'gone', status: 'CANCELLED', occurrence: day('2026-12-01') },
                ]),
            },
        }
        const res = await new GetMyClassBookingsHandler(
            prisma as never,
            classBookings as never,
        ).execute(new GetMyClassBookingsFeature('ws-1', 'user-1'))
        expect(res.upcoming.map((b) => b.id)).toEqual(['next'])
        expect(res.history.map((b) => b.id)).toEqual(['gone', 'old-2', 'old'])
        // One class load per dated class.
        expect(classBookings.loadClass).toHaveBeenCalledTimes(2)
        expect(prisma.classBooking.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'ws-1',
            userId: 'user-1',
        })
    })
})

describe('staff class-occurrence handlers', () => {
    it('roster: places, then the waitlist in queue order, then history with burns', async () => {
        const d = build()
        const res = await new GetClassOccurrenceHandler(
            d.prisma as never,
            d.rbac as never,
            d.classBookings as never,
        ).execute(new GetClassOccurrenceFeature(...staff))
        expect(res).toMatchObject({
            capacity: 8,
            capacityOverride: null,
            booked: 1,
            waitlist: 2,
            attended: 1,
            settled: false,
            cancelDeadline: '2026-11-10T04:00:00.000Z',
            occurrenceId: `${params.slotId}:${params.sessionDate}`,
        })
        expect(res.bookings.map((b) => [b.bookingId, b.waitlistPosition])).toEqual([
            ['b1', null],
            ['w1', 1],
            ['w2', 2],
            ['c', null],
        ])
        expect(res.bookings[0]).toMatchObject({ attended: true, overCapacity: true, bookedByOther: true })
        expect(res.bookings[3]).toMatchObject({ classBurned: true, burnedPlanName: '8 занятий' })
        // An admin reads without a per-group check.
        expect(d.rbac.assertCanWriteGroup).not.toHaveBeenCalled()
    })

    it('roster: a coach who sees all groups reads any class; one limited to own groups is checked', async () => {
        const all = build('coach_read_all')
        await new GetClassOccurrenceHandler(all.prisma as never, all.rbac as never, all.classBookings as never).execute(
            new GetClassOccurrenceFeature(...staff),
        )
        expect(all.rbac.assertCanWriteGroup).not.toHaveBeenCalled()

        const own = build('coach_own_only')
        own.rbac.assertCanWriteGroup.mockRejectedValueOnce(new ForbiddenError({ message: 'no' }))
        await expect(
            new GetClassOccurrenceHandler(own.prisma as never, own.rbac as never, own.classBookings as never).execute(
                new GetClassOccurrenceFeature(...staff),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(own.rbac.assertCanWriteGroup).toHaveBeenCalledWith(expect.anything(), 'group-1')
    })

    it('roster: an unknown class or a malformed date is refused', async () => {
        const d = build()
        const handler = new GetClassOccurrenceHandler(d.prisma as never, d.rbac as never, d.classBookings as never)
        await expect(
            handler.execute(new GetClassOccurrenceFeature({ ...params, sessionDate: 'tomorrow' }, 'ws-1', 'c', 'coach', false)),
        ).rejects.toBeInstanceOf(BadRequestError)
        d.classBookings.loadClass.mockRejectedValueOnce(new NotFoundError({ message: 'Занятие не найдено' }))
        await expect(handler.execute(new GetClassOccurrenceFeature(...staff))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('roster: a class nobody booked reads empty with the group’s capacity', async () => {
        const d = build()
        d.prisma.classOccurrence.findUnique.mockResolvedValue(null)
        d.prisma.attendanceSession.findUnique.mockResolvedValue(null)
        const res = await new GetClassOccurrenceHandler(d.prisma as never, d.rbac as never, d.classBookings as never).execute(
            new GetClassOccurrenceFeature(...staff),
        )
        expect(res).toMatchObject({ capacity: 8, booked: 0, waitlist: 0, attended: 0, bookings: [] })
    })

    it('add / remove / capacity need write access to the group and are audited', async () => {
        const d = build('admin')
        const add = new AddClassBookingHandler(d.prisma as never, d.rbac as never, d.classBookings as never, d.audit as never)
        await add.execute(new AddClassBookingFeature(params, { userId: 'u9' }, 'ws-1', 'coach-1', 'coach', false))
        expect(d.rbac.assertCanWriteGroup).toHaveBeenCalledWith(expect.anything(), 'group-1')
        expect(d.classBookings.addByStaff).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'u9', actorId: 'coach-1' }),
        )
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({ action: 'booking.staffAdd', targetId: 'group-1' })

        const remove = new RemoveClassBookingHandler(d.prisma as never, d.rbac as never, d.classBookings as never, d.audit as never)
        await remove.execute(new RemoveClassBookingFeature(params, 'b1', 'ws-1', 'coach-1', 'coach', false))
        expect(d.classBookings.removeByStaff).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b1' }))
        expect(d.audit.record.mock.calls[1][0].action).toBe('booking.staffRemove')

        const cap = new SetClassCapacityHandler(d.prisma as never, d.rbac as never, d.classBookings as never, d.audit as never)
        await cap.execute(new SetClassCapacityFeature(params, { capacity: 4 }, 'ws-1', 'coach-1', 'coach', false))
        expect(d.classBookings.setOccurrenceCapacity).toHaveBeenCalledWith(expect.objectContaining({ capacity: 4 }))
        expect(d.audit.record.mock.calls[2][0].action).toBe('booking.setCapacity')

        // A coach of another group is stopped before anything is written.
        d.rbac.assertCanWriteGroup.mockRejectedValue(new ForbiddenError({ message: 'no' }))
        await expect(
            add.execute(new AddClassBookingFeature(params, { userId: 'u9' }, 'ws-1', 'c', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            remove.execute(new RemoveClassBookingFeature(params, 'b1', 'ws-1', 'c', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            cap.execute(new SetClassCapacityFeature(params, { capacity: 4 }, 'ws-1', 'c', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.classBookings.addByStaff).toHaveBeenCalledTimes(1)
        expect(d.audit.record).toHaveBeenCalledTimes(3)
    })
})
