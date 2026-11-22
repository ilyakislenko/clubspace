import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { DeleteGroupSlotFeature } from './delete-group-slot.feature'
import { DeleteGroupSlotHandler } from './delete-group-slot.handler'
import { UpdateGroupSlotFeature } from './update-group-slot.feature'
import { UpdateGroupSlotHandler } from './update-group-slot.handler'

// Ending or removing a weekly class from the calendar: booked members of the
// classes that no longer happen are released (with a push, by cancelByClub);
// classes up to the new end keep their bookings.

const slotRow = (bookingMode: 'FIXED' | 'BOOKING') => ({
    id: 's1',
    groupId: 'g1',
    dayOfWeek: 1,
    startTime: '18:30',
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
    capacity: null,
    group: { bookingMode },
})

const make = (bookingMode: 'FIXED' | 'BOOKING', opts: { denied?: boolean } = {}) => {
    const calls: string[] = []
    const prisma = {
        group: { findFirst: jest.fn().mockResolvedValue({ bookingMode }) },
        groupScheduleSlot: {
            findFirst: jest.fn().mockResolvedValue(slotRow(bookingMode)),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockImplementation(async ({ data }) => ({
                ...slotRow(bookingMode),
                ...data,
            })),
            deleteMany: jest.fn().mockImplementation(async () => {
                calls.push('deleteMany')
                return { count: 1 }
            }),
        },
    }
    const audit = { record: jest.fn() }
    const classBookings = {
        cancelByClub: jest.fn().mockImplementation(async () => {
            calls.push('cancelByClub')
            return 2
        }),
    }
    const rbac = new RbacService(prisma as never)
    jest.spyOn(rbac, 'resolveCoachScope').mockResolvedValue({
        scope: 'admin',
        userId: 'me',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    })
    jest.spyOn(rbac, 'assertCanWriteGroup').mockImplementation(async () => {
        if (opts.denied) throw new ForbiddenError({ message: 'no' })
    })
    const update = (payload: object) =>
        new UpdateGroupSlotHandler(
            prisma as never,
            audit as never,
            rbac,
            classBookings as never,
        ).execute(
            new UpdateGroupSlotFeature(payload, 'w1', 'g1', 's1', 'me', 'coach', false),
        )
    const remove = () =>
        new DeleteGroupSlotHandler(
            prisma as never,
            audit as never,
            rbac,
            classBookings as never,
        ).execute(new DeleteGroupSlotFeature('w1', 'g1', 's1', 'me', 'coach', false))
    return { prisma, classBookings, calls, update, remove }
}

describe('ending a weekly class releases the bookings after the end', () => {
    it('cancels bookings from the day after the new end, by the club', async () => {
        const { classBookings, update } = make('BOOKING')
        await update({ effectiveUntil: '2026-11-15' })
        expect(classBookings.cancelByClub).toHaveBeenCalledWith({
            workspaceId: 'w1',
            groupId: 'g1',
            slotId: 's1',
            // Classes up to 15 Nov keep their bookings.
            fromDate: new Date('2026-11-16T00:00:00.000Z'),
            reason: null,
        })
    })

    it('leaves bookings alone for other slot edits and fixed groups', async () => {
        const booking = make('BOOKING')
        await booking.update({ capacity: 15 })
        expect(booking.classBookings.cancelByClub).not.toHaveBeenCalled()
        const fixed = make('FIXED')
        await fixed.update({ effectiveUntil: '2026-11-15' })
        expect(fixed.classBookings.cancelByClub).not.toHaveBeenCalled()
    })

    it('removing a booking slot releases its bookings before the slot goes', async () => {
        const { classBookings, calls, remove } = make('BOOKING')
        await remove()
        expect(classBookings.cancelByClub).toHaveBeenCalledWith({
            workspaceId: 'w1',
            groupId: 'g1',
            slotId: 's1',
            reason: null,
        })
        expect(calls).toEqual(['cancelByClub', 'deleteMany'])
    })

    it('removing a fixed slot cancels nothing; a refused writer touches nothing', async () => {
        const fixed = make('FIXED')
        await fixed.remove()
        expect(fixed.classBookings.cancelByClub).not.toHaveBeenCalled()
        const denied = make('BOOKING', { denied: true })
        await expect(denied.remove()).rejects.toBeInstanceOf(ForbiddenError)
        await expect(denied.update({ effectiveUntil: '2026-11-15' })).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(denied.classBookings.cancelByClub).not.toHaveBeenCalled()
        expect(denied.prisma.groupScheduleSlot.deleteMany).not.toHaveBeenCalled()
    })
})
