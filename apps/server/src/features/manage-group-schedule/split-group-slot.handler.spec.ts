import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { SplitGroupSlotFeature } from './split-group-slot.feature'
import { SplitGroupSlotHandler } from './split-group-slot.handler'

// 2030-01-07 and 2030-01-14 are Mondays; the gym is in Moscow (UTC+3).
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
    capacity: null,
    movedFromSlotId: null,
    movedFromDate: null,
    ...extra,
})

const build = (o: {
    slots?: SlotRow[]
    group?: null
    keyedDates?: string[]
    // Dates with only a substitute coach on them.
    substitutionDates?: string[]
    slotExceptions?: unknown[]
    movedOff?: { id: string; movedFromDate: Date | null }[]
} = {}) => {
    const slots = o.slots ?? [slot()]
    const keyed = (o.keyedDates ?? []).map((s) => ({ sessionDate: d(s) }))
    const prisma = {
        group: {
            findFirst: jest.fn().mockResolvedValue(
                o.group === null
                    ? null
                    : {
                          id: 'g-1',
                          name: 'Пилон',
                          bookingMode: 'BOOKING',
                          gym: { timezone: 'Europe/Moscow' },
                          workspace: { timezone: 'UTC' },
                          slots,
                      },
            ),
        },
        groupCoach: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'coach-1' }]),
        },
        groupMember: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ userId: 'stu-1' }, { userId: 'actor' }]),
        },
        classBooking: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'booker-1' }]),
        },
        dropInBooking: {
            // Recipients (userId) vs. the dates keyed to the slot.
            findMany: jest.fn(async ({ select }: { select: { userId?: true } }) =>
                select.userId ? [] : keyed,
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        attendanceSession: {
            findMany: jest.fn().mockResolvedValue([{ sessionDate: null }]),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        classSubstitution: {
            // Recipients (substituteId) vs. the dates keyed to the slot.
            findMany: jest.fn(async ({ select }: { select: { substituteId?: true } }) =>
                select.substituteId
                    ? []
                    : (o.substitutionDates ?? []).map((s) => ({ sessionDate: d(s) })),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        classOccurrence: {
            findMany: jest.fn().mockResolvedValue(keyed),
            update: jest.fn().mockResolvedValue({}),
        },
        scheduleException: {
            findMany: jest.fn(async ({ where }: { where: { slotId?: string } }) =>
                where.slotId ? (o.slotExceptions ?? []) : [],
            ),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
        },
        groupScheduleSlot: {
            create: jest.fn(async ({ data }: { data: object }) => ({
                ...slot({ id: 'new-slot' }),
                ...data,
            })),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: object }) => ({
                    ...(slots.find((s) => s.id === where.id) ?? slot({ id: where.id })),
                    ...data,
                }),
            ),
            findMany: jest.fn().mockResolvedValue(o.movedOff ?? []),
            delete: jest.fn().mockResolvedValue({}),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'occ-1' }]),
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(prisma),
    )
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const notifications = { writeMany: jest.fn().mockResolvedValue(1) }
    const realtime = { invalidate: jest.fn(), invalidateUsers: jest.fn() }
    const handler = new SplitGroupSlotHandler(
        prisma as never,
        audit as never,
        rbac as never,
        notifications as never,
        realtime as never,
    )
    const run = (
        payload: Partial<SplitGroupSlotFeature['payload']> = {},
        slotId = 'slot-1',
    ) =>
        handler.execute(
            new SplitGroupSlotFeature(
                {
                    fromDate: '2030-01-14',
                    newDate: '2030-01-15',
                    startTime: '20:00',
                    durationMin: 60,
                    notify: true,
                    ...payload,
                },
                'ws-1',
                'g-1',
                slotId,
                'actor',
                'admin',
                false,
            ),
        )
    return { prisma, rbac, audit, notifications, realtime, run }
}

describe('SplitGroupSlotHandler', () => {
    it('refuses a coach of another group', async () => {
        const t = build()
        t.rbac.assertCanWriteGroup.mockRejectedValue(
            new ForbiddenError({ message: 'Нет доступа к группе' }),
        )
        await expect(t.run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(t.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s an unknown group or slot', async () => {
        await expect(build({ group: null }).run()).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(build().run({}, 'slot-x')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('refuses a one-off slot, a shift beyond a week and an overlap', async () => {
        const oneOff = build({
            slots: [slot({ effectiveFrom: d('2030-01-14'), effectiveUntil: d('2030-01-14') })],
        })
        await expect(oneOff.run()).rejects.toThrow(
            'Это разовое занятие — перенесите только его',
        )
        await expect(build().run({ newDate: '2030-01-21' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        const busy = build({
            slots: [slot(), slot({ id: 'tue', dayOfWeek: 2, startTime: '20:30' })],
        })
        await expect(busy.run()).rejects.toThrow(
            'В это время у группы уже есть занятие',
        )
        expect(busy.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('cuts a slot with history: a new slot from newDate, rows/exceptions/moved classes shifted', async () => {
        const t = build({
            slots: [slot({ effectiveUntil: d('2030-03-25') })],
            keyedDates: ['2030-01-21'],
            slotExceptions: [
                {
                    id: 'exc-later',
                    slotId: 'slot-1',
                    fromDate: d('2030-01-28'),
                    untilDate: d('2030-01-28'),
                    reason: 'Перенесено на 29.01 в 19:00',
                    movedToSlotId: 'one-off',
                },
                {
                    id: 'exc-span',
                    slotId: 'slot-1',
                    fromDate: d('2030-01-07'),
                    untilDate: d('2030-02-04'),
                    reason: 'Ремонт',
                    movedToSlotId: null,
                },
            ],
            movedOff: [{ id: 'one-off', movedFromDate: d('2030-01-28') }],
        })
        const out = await t.run()
        expect(out).toEqual({
            slot: {
                id: 'new-slot',
                dayOfWeek: 2,
                startTime: '20:00',
                durationMin: 60,
                effectiveFrom: '2030-01-15',
                effectiveUntil: '2030-03-26',
                capacity: null,
            },
            previousSlotId: 'slot-1',
            merged: false,
        })
        expect(t.prisma.groupScheduleSlot.create).toHaveBeenCalledWith({
            data: {
                groupId: 'g-1',
                dayOfWeek: 2,
                startTime: '20:00',
                durationMin: 60,
                capacity: null,
                effectiveFrom: d('2030-01-15'),
                effectiveUntil: d('2030-03-26'),
            },
        })
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledWith({
            where: { id: 'slot-1' },
            data: { effectiveUntil: d('2030-01-13') },
        })
        // One date keyed (rosters without a date are skipped).
        expect(t.prisma.classOccurrence.update).toHaveBeenCalledTimes(1)
        expect(t.prisma.classOccurrence.update).toHaveBeenCalledWith({
            where: { id: 'occ-1' },
            data: {
                slotId: 'new-slot',
                sessionDate: d('2030-01-22'),
                occurrenceKey: 'slot:new-slot:2030-01-22',
                startAt: new Date('2030-01-22T17:00:00Z'),
                endAt: new Date('2030-01-22T18:00:00Z'),
            },
        })
        expect(t.prisma.scheduleException.update).toHaveBeenCalledWith({
            where: { id: 'exc-later' },
            data: {
                slotId: 'new-slot',
                fromDate: d('2030-01-29'),
                untilDate: d('2030-01-29'),
            },
        })
        expect(t.prisma.scheduleException.update).toHaveBeenCalledWith({
            where: { id: 'exc-span' },
            data: { untilDate: d('2030-01-13') },
        })
        expect(t.prisma.scheduleException.create).toHaveBeenCalledWith({
            data: {
                groupId: 'g-1',
                slotId: 'new-slot',
                fromDate: d('2030-01-15'),
                untilDate: d('2030-02-05'),
                reason: 'Ремонт',
                movedToSlotId: null,
            },
        })
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledWith({
            where: { id: 'one-off' },
            data: { movedFromSlotId: 'new-slot', movedFromDate: d('2030-01-29') },
        })
        expect(t.prisma.groupScheduleSlot.delete).not.toHaveBeenCalled()
        expect(t.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'group.slotSplit',
                targetId: 'g-1',
                metadata: {
                    slotId: 'slot-1',
                    fromDate: '2030-01-14',
                    targetSlotId: 'new-slot',
                    newDate: '2030-01-15',
                    startTime: '20:00',
                    durationMin: 60,
                    merged: false,
                    inPlace: false,
                },
            }),
        )
        // Split tells every member even of a «Запись на занятие» group.
        const rows = t.notifications.writeMany.mock.calls[0][0]
        expect(rows.map((r: { userId: string }) => r.userId).sort()).toEqual([
            'booker-1',
            'coach-1',
            'stu-1',
        ])
        expect(rows[0]).toMatchObject({
            topic: 'Расписание изменилось',
            message: '«Пилон»: с 15.01 — Вт 20:00–21:00 (было Пн 19:00–20:00)',
            metadata: {
                kind: 'schedule.moved',
                slotId: 'new-slot',
                sessionDate: '2030-01-15',
            },
        })
        expect(t.prisma.classBooking.findMany.mock.calls[0][0].where).toEqual({
            status: { in: ['BOOKED', 'WAITLISTED'] },
            occurrence: {
                workspaceId: 'ws-1',
                slotId: 'slot-1',
                sessionDate: { gte: d('2030-01-14') },
            },
        })
        expect(t.realtime.invalidate).toHaveBeenCalled()
    })

    it('changes a slot without history in place', async () => {
        const t = build({
            slots: [slot({ effectiveFrom: d('2030-01-14') })],
            keyedDates: ['2030-01-14'],
        })
        const out = await t.run({ notify: false })
        expect(out.previousSlotId).toBeNull()
        expect(out.merged).toBe(false)
        expect(out.slot).toMatchObject({
            id: 'slot-1',
            dayOfWeek: 2,
            startTime: '20:00',
            effectiveFrom: '2030-01-15',
            effectiveUntil: null,
        })
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledTimes(1)
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledWith({
            where: { id: 'slot-1' },
            data: {
                dayOfWeek: 2,
                startTime: '20:00',
                durationMin: 60,
                effectiveFrom: d('2030-01-15'),
                effectiveUntil: null,
            },
        })
        expect(t.prisma.classOccurrence.update.mock.calls[0][0].data).toMatchObject({
            slotId: 'slot-1',
            occurrenceKey: 'slot:slot-1:2030-01-15',
        })
        expect(t.prisma.groupScheduleSlot.create).not.toHaveBeenCalled()
        expect(t.notifications.writeMany).not.toHaveBeenCalled()
        expect(t.audit.record.mock.calls[0][0].metadata).toMatchObject({
            inPlace: true,
            merged: false,
        })
    })

    it('shifts a future class that only has a substitute coach on it', async () => {
        const t = build({
            slots: [slot({ effectiveFrom: d('2030-01-14') })],
            substitutionDates: ['2030-01-21'],
        })
        await t.run({ notify: false })
        expect(t.prisma.classSubstitution.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'ws-1',
            slotId: 'slot-1',
            sessionDate: { gte: d('2030-01-14') },
        })
        expect(t.prisma.classSubstitution.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1', occurrenceKey: 'slot:slot-1:2030-01-21' },
            data: {
                slotId: 'slot-1',
                sessionDate: d('2030-01-22'),
                occurrenceKey: 'slot:slot-1:2030-01-22',
            },
        })
    })

    it('merges back into the series that ended the week before (undo of a split)', async () => {
        const ended = slot({ id: 'mon', effectiveUntil: d('2030-01-13') })
        const tue = slot({
            id: 'tue',
            dayOfWeek: 2,
            effectiveFrom: d('2030-01-15'),
        })
        const t = build({ slots: [ended, tue], keyedDates: ['2030-01-22'] })
        const out = await t.run(
            { fromDate: '2030-01-15', newDate: '2030-01-14', startTime: '19:00' },
            'tue',
        )
        expect(out).toEqual({
            slot: expect.objectContaining({ id: 'mon', effectiveUntil: null }),
            previousSlotId: null,
            merged: true,
        })
        expect(t.prisma.groupScheduleSlot.update).toHaveBeenCalledWith({
            where: { id: 'mon' },
            data: { effectiveUntil: null },
        })
        expect(t.prisma.classOccurrence.update.mock.calls[0][0].data).toMatchObject({
            slotId: 'mon',
            occurrenceKey: 'slot:mon:2030-01-21',
            startAt: new Date('2030-01-21T16:00:00Z'),
        })
        expect(t.prisma.groupScheduleSlot.delete).toHaveBeenCalledWith({
            where: { id: 'tue' },
        })
        expect(t.prisma.groupScheduleSlot.create).not.toHaveBeenCalled()
    })
})
