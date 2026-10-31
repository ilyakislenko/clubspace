import type { PushNotificationRow } from '../notifications/services/notification-producer.service'
import { RemindersService } from './reminders.service'

// The dispatch *flow* — query, claim, write — with stubbed Prisma. The slot
// stub evaluates the (dayOfWeek, startTime, time zone) clauses the service
// builds, so a wrong weekday or wall clock means no candidate, as in SQL.

const baseNow = new Date('2026-05-08T12:00:00Z') // Friday, ISO dow 5

type Slot = {
    id: string
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: Date | null
    effectiveUntil: Date | null
    group: {
        id: string
        name: string
        workspaceId: string
        workspace: { timezone: string }
        gym: { timezone: string | null; name: string } | null
    }
}

const slot = (
    startTime: string,
    extras: Partial<{
        id: string
        dayOfWeek: number
        tz: string
        gymTz: string | null
        noGym: boolean
    }> = {},
): Slot => ({
    id: extras.id ?? 'slot-1',
    dayOfWeek: extras.dayOfWeek ?? 5,
    startTime,
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
    group: {
        id: 'g-1',
        name: 'Утренняя',
        workspaceId: 'ws-1',
        workspace: { timezone: extras.tz ?? 'UTC' },
        gym: extras.noGym
            ? null
            : { timezone: extras.gymTz ?? null, name: 'Сибиряк' },
    },
})

type Clause = {
    dayOfWeek: number
    startTime: { in: string[] }
    group: { OR: [{ gym: { is: { timezone: string } } }, unknown] }
}

const buildPrisma = (
    o: Partial<{
        slots: Slot[]
        events: unknown[]
        exceptions: unknown[]
        slotExceptions: unknown[]
        members: unknown[]
        bookings: { slotId: string; sessionDate: Date; userId: string }[]
        claimedAlready: (kind: string, refId: string) => boolean
    }> = {},
) => {
    const slots = o.slots ?? []
    const zones = [...new Set(slots.map((s) => s.group.workspace.timezone))]
    const gymZones = [
        ...new Set(
            slots.flatMap((s) => (s.group.gym?.timezone ? [s.group.gym.timezone] : [])),
        ),
    ]
    const claimedAlready = o.claimedAlready ?? (() => false)
    return {
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValue((zones.length ? zones : ['UTC']).map((timezone) => ({ timezone }))),
        },
        gym: {
            findMany: jest.fn().mockResolvedValue(gymZones.map((timezone) => ({ timezone }))),
        },
        groupScheduleSlot: {
            findMany: jest.fn(async ({ where }: { where: { OR: Clause[] } }) =>
                slots.filter((s) =>
                    where.OR.some(
                        (c) =>
                            c.dayOfWeek === s.dayOfWeek &&
                            c.startTime.in.includes(s.startTime) &&
                            c.group.OR[0].gym.is.timezone ===
                                (s.group.gym?.timezone ?? s.group.workspace.timezone),
                    ),
                ),
            ),
        },
        scheduleException: {
            findMany: jest.fn(async (args: { include?: unknown }) =>
                args.include ? (o.exceptions ?? []) : (o.slotExceptions ?? []),
            ),
        },
        group: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 'g-1',
                    coaches: [{ userId: 'coach-1' }],
                    members: [{ userId: 'stu-1' }, { userId: 'stu-2' }],
                },
            ]),
        },
        dropInBooking: {
            findMany: jest.fn().mockResolvedValue(o.bookings ?? []),
        },
        workspaceEvent: {
            findMany: jest.fn().mockResolvedValue(o.events ?? []),
        },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue(o.members ?? []),
        },
        notificationDispatchLog: {
            createManyAndReturn: jest.fn(
                async ({ data }: { data: { kind: string; refId: string }[] }) =>
                    data
                        .filter((d) => !claimedAlready(d.kind, d.refId))
                        .map((d) => ({ refId: d.refId })),
            ),
            findMany: jest.fn().mockResolvedValue([]),
        },
        announcement: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    }
}

const build = (prisma: ReturnType<typeof buildPrisma>) => {
    const rows: PushNotificationRow[] = []
    const notifications = {
        writeMany: jest.fn(async (batch: PushNotificationRow[]) => {
            rows.push(...batch)
            return batch.length
        }),
        notifyWorkspace: jest.fn().mockResolvedValue(1),
    }
    const realtime = { emitListDelta: jest.fn() }
    const svc = new RemindersService(
        prisma as never,
        notifications as never,
        realtime as never,
    )
    return { svc, rows, notifications, realtime }
}

describe('RemindersService session reminders', () => {
    it('writes one row per coach and member, in a single batch, for a class in the window', async () => {
        const prisma = buildPrisma({ slots: [slot('13:00')] })
        const { svc, rows, notifications } = build(prisma)

        const summary = await svc.run(baseNow)

        expect(summary.sessionsNotified).toBe(1)
        expect(notifications.writeMany).toHaveBeenCalledTimes(1)
        expect(rows.map((r) => r.userId).sort()).toEqual(['coach-1', 'stu-1', 'stu-2'])
        expect(rows[0]).toMatchObject({
            topic: 'Через час тренировка',
            message: 'Утренняя · Сибиряк в 13:00',
            metadata: {
                kind: 'session.reminder',
                workspaceId: 'ws-1',
                occurrenceId: 'slot-1:2026-05-08',
                groupId: 'g-1',
                startAt: '2026-05-08T13:00:00.000Z',
            },
        })
        expect(prisma.notificationDispatchLog.createManyAndReturn).toHaveBeenCalledWith({
            data: [{ kind: 'session.reminder', refId: 'slot-1:2026-05-08' }],
            skipDuplicates: true,
            select: { refId: true },
        })
    })

    it('queries only the window minutes: one clause per zone and local date', async () => {
        const prisma = buildPrisma({ slots: [slot('13:00')] })
        const { svc } = build(prisma)
        await svc.run(baseNow)

        const { where } = prisma.groupScheduleSlot.findMany.mock.calls[0][0]
        expect(where.OR).toHaveLength(1)
        expect(where.OR[0].dayOfWeek).toBe(5)
        // 12:55 … 13:05, every whole minute.
        expect(where.OR[0].startTime.in).toHaveLength(11)
        expect(where.OR[0].startTime.in[0]).toBe('12:55')
        expect(where.OR[0].startTime.in[10]).toBe('13:05')
    })

    it('reminds a 21:30 New York class at 00:30 UTC, on the club-local weekday', async () => {
        // Friday 21:30 EDT is Saturday 01:30 UTC.
        const now = new Date('2026-05-09T00:30:00Z')
        const prisma = buildPrisma({
            slots: [slot('21:30', { dayOfWeek: 5, tz: 'America/New_York', noGym: true })],
        })
        const { svc, rows } = build(prisma)

        const summary = await svc.run(now)

        expect(summary.sessionsNotified).toBe(1)
        expect(rows[0].metadata).toMatchObject({
            occurrenceId: 'slot-1:2026-05-08',
            startAt: '2026-05-09T01:30:00.000Z',
        })
    })

    it('uses the gym time zone over the club one', async () => {
        // 13:00 UTC is 20:00 in Novosibirsk.
        const prisma = buildPrisma({
            slots: [slot('20:00', { tz: 'Europe/Moscow', gymTz: 'Asia/Novosibirsk' })],
        })
        const { svc, rows } = build(prisma)
        await svc.run(baseNow)
        expect(rows[0].metadata.startAt).toBe('2026-05-08T13:00:00.000Z')
    })

    it('splits the window across local midnight into two dated clauses', async () => {
        // 23:00 UTC + 55..65 min straddles midnight in UTC.
        const now = new Date('2026-05-08T23:00:00Z')
        const prisma = buildPrisma({ slots: [slot('00:02', { dayOfWeek: 6 })] })
        const { svc, rows } = build(prisma)

        await svc.run(now)

        const { where } = prisma.groupScheduleSlot.findMany.mock.calls[0][0]
        expect(where.OR.map((c: Clause) => c.dayOfWeek)).toEqual([5, 6])
        expect(rows[0].metadata.occurrenceId).toBe('slot-1:2026-05-09')
    })

    it('also reminds drop-in bookers of that occurrence, once even if they are members', async () => {
        const prisma = buildPrisma({
            slots: [slot('13:00')],
            bookings: [
                { slotId: 'slot-1', sessionDate: new Date('2026-05-08T00:00:00Z'), userId: 'guest-1' },
                { slotId: 'slot-1', sessionDate: new Date('2026-05-08T00:00:00Z'), userId: 'stu-1' },
            ],
        })
        const { svc, rows } = build(prisma)
        await svc.run(baseNow)
        expect(rows.map((r) => r.userId).sort()).toEqual([
            'coach-1',
            'guest-1',
            'stu-1',
            'stu-2',
        ])
        expect(prisma.dropInBooking.findMany.mock.calls[0][0].where).toEqual({
            OR: [{ slotId: 'slot-1', sessionDate: new Date('2026-05-08T00:00:00Z') }],
        })
    })

    it('skips an occurrence another run already claimed', async () => {
        const prisma = buildPrisma({
            slots: [slot('13:00')],
            claimedAlready: (kind) => kind === 'session.reminder',
        })
        const { svc, notifications } = build(prisma)
        const summary = await svc.run(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(notifications.writeMany).not.toHaveBeenCalled()
    })

    it('skips a class cancelled by an exception', async () => {
        const day = new Date('2026-05-08T00:00:00Z')
        const prisma = buildPrisma({
            slots: [slot('13:00')],
            slotExceptions: [
                { groupId: 'g-1', slotId: null, fromDate: day, untilDate: day, reason: null },
            ],
        })
        const { svc, rows } = build(prisma)
        const summary = await svc.run(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(rows).toHaveLength(0)
    })

    it('skips a slot outside its effective dates', async () => {
        const s = slot('13:00')
        s.effectiveUntil = new Date('2026-05-07T00:00:00Z')
        const prisma = buildPrisma({ slots: [s] })
        const { svc } = build(prisma)
        expect((await svc.run(baseNow)).sessionsNotified).toBe(0)
    })

    it('finds nothing for a class outside the window', async () => {
        const prisma = buildPrisma({ slots: [slot('18:00')] })
        const { svc, notifications } = build(prisma)
        expect((await svc.run(baseNow)).sessionsNotified).toBe(0)
        expect(prisma.scheduleException.findMany).toHaveBeenCalledTimes(1) // notices only
        expect(notifications.writeMany).not.toHaveBeenCalled()
    })
})

describe('RemindersService event reminders', () => {
    const event = {
        id: 'evt-1',
        workspaceId: 'ws-1',
        title: 'Open mat',
        startAt: new Date(baseNow.getTime() + 60 * 60_000),
        link: null,
        gym: { name: 'Зал', address: '' },
    }

    it('writes one row per ACTIVE club member, in one batch', async () => {
        const prisma = buildPrisma({
            events: [event],
            members: [
                { userId: 'u-1', workspaceId: 'ws-1' },
                { userId: 'u-2', workspaceId: 'ws-1' },
                { userId: 'other', workspaceId: 'ws-2' },
            ],
        })
        const { svc, rows } = build(prisma)

        const summary = await svc.run(baseNow)

        expect(summary.eventsNotified).toBe(1)
        expect(rows.map((r) => r.userId)).toEqual(['u-1', 'u-2'])
        expect(rows[0]).toMatchObject({
            topic: 'Через час событие',
            message: 'Open mat · Зал',
            metadata: { kind: 'event.reminder', workspaceId: 'ws-1', eventId: 'evt-1' },
        })
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: { in: ['ws-1'] },
            status: 'ACTIVE',
        })
    })

    it('does not re-send an event another run claimed', async () => {
        const prisma = buildPrisma({
            events: [event],
            claimedAlready: (kind) => kind === 'event.reminder',
        })
        const { svc } = build(prisma)
        expect((await svc.run(baseNow)).eventsNotified).toBe(0)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })
})

describe('RemindersService cancellation notices', () => {
    const exception = (extras: Record<string, unknown> = {}) => ({
        id: 'exc-1',
        groupId: 'g-1',
        slotId: null,
        slot: null,
        fromDate: new Date('2026-05-08T00:00:00Z'),
        untilDate: new Date('2026-05-08T00:00:00Z'),
        reason: 'Отпуск',
        group: {
            workspaceId: 'ws-1',
            name: 'Утренняя',
            coaches: [{ userId: 'coach-1' }],
            members: [{ userId: 'stu-1' }, { userId: 'stu-2' }],
        },
        ...extras,
    })

    it('notifies the group with the cancelled range', async () => {
        const prisma = buildPrisma({ exceptions: [exception()] })
        const { svc, rows } = build(prisma)
        const summary = await svc.run(baseNow)
        expect(summary.cancellationsNotified).toBe(1)
        expect(rows).toHaveLength(3)
        expect(rows[0]).toMatchObject({
            topic: 'Тренировка отменена',
            message: 'Утренняя: 8 мая (вся группа) — Отпуск',
            metadata: { kind: 'exception.notify', workspaceId: 'ws-1' },
        })
    })

    it('includes drop-in bookers of the cancelled class and names a multi-day slot range', async () => {
        const prisma = buildPrisma({
            exceptions: [
                exception({
                    slotId: 'slot-1',
                    slot: { startTime: '19:00', dayOfWeek: 5 },
                    untilDate: new Date('2026-05-15T00:00:00Z'),
                    reason: null,
                }),
            ],
            bookings: [
                { slotId: 'slot-1', sessionDate: new Date('2026-05-08T00:00:00Z'), userId: 'guest-1' },
            ],
        })
        const { svc, rows } = build(prisma)
        await svc.run(baseNow)
        expect(rows.map((r) => r.userId).sort()).toEqual([
            'coach-1',
            'guest-1',
            'stu-1',
            'stu-2',
        ])
        expect(rows[0].message).toBe('Утренняя: 8 мая — 15 мая (Пт 19:00)')
        expect(prisma.dropInBooking.findMany).toHaveBeenCalledWith({
            where: {
                groupId: 'g-1',
                slotId: 'slot-1',
                sessionDate: {
                    gte: new Date('2026-05-08T00:00:00Z'),
                    lte: new Date('2026-05-15T00:00:00Z'),
                },
            },
            select: { userId: true },
        })
    })

    it('skips an exception already announced', async () => {
        const prisma = buildPrisma({
            exceptions: [exception()],
            claimedAlready: (kind) => kind === 'exception.notify',
        })
        const { svc, rows } = build(prisma)
        expect((await svc.run(baseNow)).cancellationsNotified).toBe(0)
        expect(rows).toHaveLength(0)
    })
})

describe('RemindersService scheduled announcements', () => {
    const goneLive = () => ({
        id: 'a1',
        workspaceId: 'w1',
        title: 'Открытие зала',
        body: 'Ждём всех',
        authorId: 'author',
        pinned: false,
        audience: 'ALL',
        publishedAt: new Date(baseNow.getTime() - 60_000),
        createdAt: baseNow,
        updatedAt: baseNow,
        author: { firstname: 'Coach', lastname: null, email: 'c@x' },
    })

    it('fans out an announcement that has just gone live', async () => {
        const prisma = buildPrisma()
        prisma.announcement.findMany.mockResolvedValue([goneLive()])
        const { svc, notifications, realtime } = build(prisma)

        const summary = await svc.run(baseNow)

        expect(summary.scheduledAnnouncementsPublished).toBe(1)
        expect(notifications.notifyWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'w1',
                kind: 'announcement.published',
                refId: 'a1',
                feature: 'announcements',
            }),
        )
        expect(realtime.emitListDelta).toHaveBeenCalledWith(
            'w1',
            'announcements',
            'create',
            expect.objectContaining({ id: 'a1' }),
        )
    })

    it('does not re-publish one already fanned out', async () => {
        const prisma = buildPrisma()
        prisma.announcement.findMany.mockResolvedValue([goneLive()])
        prisma.notificationDispatchLog.findMany.mockResolvedValue([{ refId: 'a1' }])
        const { svc, notifications } = build(prisma)
        expect((await svc.run(baseNow)).scheduledAnnouncementsPublished).toBe(0)
        expect(notifications.notifyWorkspace).not.toHaveBeenCalled()
    })
})
