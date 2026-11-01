import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { MoveGroupOccurrenceFeature } from './move-group-occurrence.feature'
import { MoveGroupOccurrenceHandler } from './move-group-occurrence.handler'

// 2030-01-07 is a Monday; the gym is in Moscow (UTC+3).
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

type SlotRow = {
    id: string
    groupId: string
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: Date | null
    effectiveUntil: Date | null
    capacity: number | null
    movedFromSlotId: string | null
    movedFromDate: Date | null
}

const slot = (extra: Partial<SlotRow> = {}): SlotRow => ({
    id: 'slot-1',
    groupId: 'g-1',
    dayOfWeek: 1,
    startTime: '19:00',
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
    capacity: 12,
    movedFromSlotId: null,
    movedFromDate: null,
    ...extra,
})

const build = (o: {
    slots?: SlotRow[]
    group?: null
    bookingMode?: 'FIXED' | 'BOOKING'
    exceptions?: unknown[]
    occurrence?: boolean
} = {}) => {
    const prisma = {
        group: {
            findFirst: jest.fn().mockResolvedValue(
                o.group === null
                    ? null
                    : {
                          id: 'g-1',
                          name: 'Пилон',
                          bookingMode: o.bookingMode ?? 'FIXED',
                          gym: { timezone: 'Europe/Moscow' },
                          workspace: { timezone: 'UTC' },
                          slots: o.slots ?? [slot()],
                      },
            ),
        },
        groupCoach: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ userId: 'coach-1' }, { userId: 'actor' }]),
        },
        groupMember: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'stu-1' }]),
        },
        classBooking: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'booker-1' }]),
        },
        dropInBooking: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'guest-1' }]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        attendanceSession: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        classSubstitution: {
            findMany: jest.fn().mockResolvedValue([{ substituteId: 'sub-1' }]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        classOccurrence: {
            update: jest.fn().mockResolvedValue({}),
        },
        scheduleException: {
            findMany: jest.fn().mockResolvedValue(o.exceptions ?? []),
            create: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        groupScheduleSlot: {
            create: jest.fn(async ({ data }: { data: object }) => ({
                id: 'one-off',
                ...data,
            })),
            update: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        },
        $queryRaw: jest
            .fn()
            .mockResolvedValue(o.occurrence === false ? [] : [{ id: 'occ-1' }]),
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(prisma),
    )
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'coach' }),
        assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const notifications = { writeMany: jest.fn().mockResolvedValue(1) }
    const realtime = { invalidate: jest.fn(), invalidateUsers: jest.fn() }
    const handler = new MoveGroupOccurrenceHandler(
        prisma as never,
        audit as never,
        rbac as never,
        notifications as never,
        realtime as never,
    )
    const run = (
        payload: Partial<MoveGroupOccurrenceFeature['payload']> = {},
        slotId = 'slot-1',
        sessionDate = '2030-01-07',
    ) =>
        handler.execute(
            new MoveGroupOccurrenceFeature(
                {
                    newDate: '2030-01-08',
                    startTime: '20:00',
                    durationMin: 60,
                    notify: true,
                    ...payload,
                },
                'ws-1',
                'g-1',
                slotId,
                sessionDate,
                'actor',
                'coach',
                false,
            ),
        )
    return { prisma, rbac, audit, notifications, realtime, run }
}

describe('MoveGroupOccurrenceHandler', () => {
    it('refuses a coach of another group before touching anything', async () => {
        const t = build()
        t.rbac.assertCanWriteGroup.mockRejectedValue(
            new ForbiddenError({ message: 'Нет доступа к группе' }),
        )
        await expect(t.run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(t.rbac.assertCanWriteGroup).toHaveBeenCalledWith(
            { scope: 'coach' },
            'g-1',
        )
        expect(t.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s an unknown group or a slot of another group', async () => {
        await expect(build({ group: null }).run()).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(build().run({}, 'slot-x')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('400s a malformed date, an overlap and a cancelled class', async () => {
        await expect(build().run({}, 'slot-1', '07.01.2030')).rejects.toBeInstanceOf(
            BadRequestError,
        )
        const busy = build({
            slots: [slot(), slot({ id: 'tue', dayOfWeek: 2, startTime: '20:30' })],
        })
        await expect(busy.run()).rejects.toThrow(
            'В это время у группы уже есть занятие',
        )
        const cancelled = build({
            exceptions: [
                {
                    slotId: null,
                    fromDate: d('2030-01-07'),
                    untilDate: d('2030-01-07'),
                    movedToSlotId: null,
                },
            ],
        })
        await expect(cancelled.run()).rejects.toThrow(
            'Занятие отменено — сначала верните его',
        )
        expect(busy.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('moves a weekly class onto a new one-off slot, leaving a ghost and re-keying its rows', async () => {
        const t = build()
        await expect(t.run()).resolves.toEqual({
            slotId: 'one-off',
            sessionDate: '2030-01-08',
            restored: false,
        })
        expect(t.prisma.groupScheduleSlot.create).toHaveBeenCalledWith({
            data: {
                groupId: 'g-1',
                dayOfWeek: 2,
                startTime: '20:00',
                durationMin: 60,
                effectiveFrom: d('2030-01-08'),
                effectiveUntil: d('2030-01-08'),
                capacity: 12,
                movedFromSlotId: 'slot-1',
                movedFromDate: d('2030-01-07'),
            },
        })
        expect(t.prisma.scheduleException.create).toHaveBeenCalledWith({
            data: {
                groupId: 'g-1',
                slotId: 'slot-1',
                fromDate: d('2030-01-07'),
                untilDate: d('2030-01-07'),
                reason: 'Перенесено на 08.01 в 20:00',
                movedToSlotId: 'one-off',
            },
        })
        expect(t.prisma.$queryRaw.mock.calls[0]).toContain(
            'slot:slot-1:2030-01-07',
        )
        expect(t.prisma.classOccurrence.update).toHaveBeenCalledWith({
            where: { id: 'occ-1' },
            data: {
                slotId: 'one-off',
                sessionDate: d('2030-01-08'),
                occurrenceKey: 'slot:one-off:2030-01-08',
                startAt: new Date('2030-01-08T17:00:00Z'),
                endAt: new Date('2030-01-08T18:00:00Z'),
            },
        })
        expect(t.prisma.dropInBooking.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1', occurrenceKey: 'slot:slot-1:2030-01-07' },
            data: {
                slotId: 'one-off',
                sessionDate: d('2030-01-08'),
                occurrenceKey: 'slot:one-off:2030-01-08',
            },
        })
        expect(t.prisma.attendanceSession.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1', occurrenceKey: 'slot:slot-1:2030-01-07' },
            data: {
                slotId: 'one-off',
                sessionDate: d('2030-01-08'),
                occurrenceKey: 'slot:one-off:2030-01-08',
                startAt: new Date('2030-01-08T17:00:00Z'),
            },
        })
        // The substitute coach of that class moves with it.
        expect(t.prisma.classSubstitution.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1', occurrenceKey: 'slot:slot-1:2030-01-07' },
            data: {
                slotId: 'one-off',
                sessionDate: d('2030-01-08'),
                occurrenceKey: 'slot:one-off:2030-01-08',
            },
        })
        expect(t.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'group.occurrenceMove',
                targetType: 'group',
                targetId: 'g-1',
                metadata: {
                    slotId: 'slot-1',
                    sessionDate: '2030-01-07',
                    targetSlotId: 'one-off',
                    newDate: '2030-01-08',
                    startTime: '20:00',
                    durationMin: 60,
                    restored: false,
                },
            }),
        )
        expect(t.realtime.invalidate).toHaveBeenCalledWith('ws-1', [
            'schedule',
            'groups',
            'attendance',
            'classbookings',
        ])
        // A fixed group: coaches + the substitute + members + guests, never the actor.
        const rows = t.notifications.writeMany.mock.calls[0][0]
        expect(rows.map((r: { userId: string }) => r.userId).sort()).toEqual([
            'coach-1',
            'guest-1',
            'stu-1',
            'sub-1',
        ])
        expect(rows[0]).toMatchObject({
            topic: 'Занятие перенесено',
            message: '«Пилон»: 07.01 в 19:00 → 08.01 в 20:00',
            link: null,
            metadata: {
                kind: 'schedule.moved',
                workspaceId: 'ws-1',
                groupId: 'g-1',
                slotId: 'one-off',
                sessionDate: '2030-01-08',
            },
        })
        expect(t.prisma.classBooking.findMany).not.toHaveBeenCalled()
    })

    it('a «Запись на занятие» class notifies its live bookings instead of the roster', async () => {
        const t = build({ bookingMode: 'BOOKING', occurrence: false })
        await t.run()
        expect(t.prisma.groupMember.findMany).not.toHaveBeenCalled()
        expect(t.prisma.classBooking.findMany).toHaveBeenCalledWith({
            where: {
                status: { in: ['BOOKED', 'WAITLISTED'] },
                occurrence: {
                    workspaceId: 'ws-1',
                    slotId: 'slot-1',
                    sessionDate: d('2030-01-07'),
                },
            },
            select: { userId: true },
        })
        const ids = t.notifications.writeMany.mock.calls[0][0].map(
            (r: { userId: string }) => r.userId,
        )
        expect(ids.sort()).toEqual(['booker-1', 'coach-1', 'guest-1', 'sub-1'])
        // No class row yet: nothing to update, the rest still re-keys.
        expect(t.prisma.classOccurrence.update).not.toHaveBeenCalled()
        expect(t.prisma.dropInBooking.updateMany).toHaveBeenCalled()
    })

    it('moves a one-off slot in place and rewrites its ghost reason', async () => {
        const moved = slot({
            id: 'one-off',
            dayOfWeek: 2,
            startTime: '20:00',
            effectiveFrom: d('2030-01-08'),
            effectiveUntil: d('2030-01-08'),
            movedFromSlotId: 'slot-1',
            movedFromDate: d('2030-01-07'),
        })
        const t = build({ slots: [slot(), moved] })
        await expect(
            t.run({ newDate: '2030-01-09', startTime: '18:00', notify: false }, 'one-off', '2030-01-08'),
        ).resolves.toEqual({
            slotId: 'one-off',
            sessionDate: '2030-01-09',
            restored: false,
        })
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledWith({
            where: { id: 'one-off' },
            data: {
                dayOfWeek: 3,
                startTime: '18:00',
                durationMin: 60,
                effectiveFrom: d('2030-01-09'),
                effectiveUntil: d('2030-01-09'),
            },
        })
        expect(t.prisma.scheduleException.updateMany).toHaveBeenCalledWith({
            where: { movedToSlotId: 'one-off' },
            data: { reason: 'Перенесено на 09.01 в 18:00' },
        })
        expect(t.prisma.classOccurrence.update.mock.calls[0][0].data).toMatchObject({
            slotId: 'one-off',
            occurrenceKey: 'slot:one-off:2030-01-09',
        })
        expect(t.prisma.groupScheduleSlot.create).not.toHaveBeenCalled()
        expect(t.notifications.writeMany).not.toHaveBeenCalled()
    })

    it('restores a moved class dragged back onto its origin', async () => {
        const moved = slot({
            id: 'one-off',
            dayOfWeek: 2,
            startTime: '20:00',
            effectiveFrom: d('2030-01-08'),
            effectiveUntil: d('2030-01-08'),
            movedFromSlotId: 'slot-1',
            movedFromDate: d('2030-01-07'),
        })
        const t = build({
            slots: [slot(), moved],
            // The ghost on the origin date does not block the way back.
            exceptions: [
                {
                    slotId: 'slot-1',
                    fromDate: d('2030-01-07'),
                    untilDate: d('2030-01-07'),
                    movedToSlotId: 'one-off',
                },
            ],
        })
        await expect(
            t.run({ newDate: '2030-01-07', startTime: '19:00' }, 'one-off', '2030-01-08'),
        ).resolves.toEqual({
            slotId: 'slot-1',
            sessionDate: '2030-01-07',
            restored: true,
        })
        expect(t.prisma.classOccurrence.update.mock.calls[0][0].data).toMatchObject({
            slotId: 'slot-1',
            occurrenceKey: 'slot:slot-1:2030-01-07',
            startAt: new Date('2030-01-07T16:00:00Z'),
        })
        expect(t.prisma.scheduleException.deleteMany).toHaveBeenCalledWith({
            where: { movedToSlotId: 'one-off' },
        })
        expect(t.prisma.groupScheduleSlot.delete).toHaveBeenCalledWith({
            where: { id: 'one-off' },
        })
        // Rows re-keyed before the slot (and its cascade) goes.
        expect(
            t.prisma.classOccurrence.update.mock.invocationCallOrder[0],
        ).toBeLessThan(t.prisma.groupScheduleSlot.delete.mock.invocationCallOrder[0])
        expect(t.audit.record.mock.calls[0][0].metadata.restored).toBe(true)
        expect(t.notifications.writeMany.mock.calls[0][0][0].message).toBe(
            '«Пилон»: 08.01 в 20:00 → 07.01 в 19:00',
        )
    })

    it('refuses to move the ghost a previous move left behind', async () => {
        const t = build({
            exceptions: [
                {
                    slotId: 'slot-1',
                    fromDate: d('2030-01-07'),
                    untilDate: d('2030-01-07'),
                    movedToSlotId: 'one-off',
                },
            ],
        })
        await expect(t.run()).rejects.toThrow(
            'Занятие уже перенесено — перетащите его на новом месте',
        )
    })
})
