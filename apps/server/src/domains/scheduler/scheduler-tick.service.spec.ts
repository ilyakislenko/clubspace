import { SchedulerTickService } from './scheduler-tick.service'

// We exercise the dispatch *flow* — query, claim, write — with stubbed
// Prisma so the tests don't need a DB. The point is to lock in:
//   - sessions inside the [now+55, now+65] window get one row each
//   - cancelled sessions don't get a row
//   - the dispatch ledger is consulted before fan-out (so a re-tick is
//     idempotent)
//   - exception fan-out skips when ledger already has the entry

const baseNow = new Date('2026-05-08T12:00:00Z')

const buildPrisma = (overrides: Partial<{
    slots: any[]
    events: any[]
    exceptions: any[]
    members: any[]
    bookers: string[]
    optedOutUserIds: string[]
    ledgerHasKey: (kind: string, refId: string) => boolean
}> = {}) => {
    const slots = overrides.slots ?? []
    const events = overrides.events ?? []
    const exceptions = overrides.exceptions ?? []
    const members = overrides.members ?? []
    const bookers = overrides.bookers ?? []
    const optedOutUserIds = overrides.optedOutUserIds ?? []
    const ledgerHasKey =
        overrides.ledgerHasKey ?? (() => false)

    const notifications: unknown[] = []

    const prisma = {
        groupScheduleSlot: {
            findMany: jest.fn().mockResolvedValue(slots),
        },
        workspaceEvent: {
            findMany: jest.fn().mockResolvedValue(events),
        },
        dropInBooking: {
            findMany: jest
                .fn()
                .mockResolvedValue(bookers.map((userId) => ({ userId }))),
        },
        scheduleException: {
            findMany: jest.fn().mockResolvedValue(exceptions),
        },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue(members),
        },
        attendanceRecord: {
            groupBy: jest.fn().mockResolvedValue([]),
        },
        notificationPreferences: {
            findMany: jest
                .fn()
                .mockResolvedValue(
                    optedOutUserIds.map((userId) => ({ userId })),
                ),
        },
        notification: {
            create: jest.fn(async ({ data }: any) => {
                notifications.push(data)
                return { id: `n-${notifications.length}` }
            }),
        },
        notificationDispatchLog: {
            create: jest.fn(async ({ data }: any) => {
                if (ledgerHasKey(data.kind, data.refId)) {
                    const err = new Error('uniq') as Error & { code: string }
                    err.code = 'P2002'
                    throw err
                }
                return data
            }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        announcement: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    }
    return { prisma, notifications }
}

const session = (
    startTime: string,
    durationMin: number,
    extras: Partial<{
        gymTz: string | null
        memberIds: string[]
        coachIds: string[]
        exceptions: any[]
    }> = {},
) => ({
    id: 'slot-1',
    dayOfWeek: ((baseNow.getDay() + 6) % 7) + 1,
    startTime,
    durationMin,
    effectiveFrom: null,
    effectiveUntil: null,
    group: {
        id: 'g-1',
        name: 'Утренняя',
        workspace: { timezone: 'UTC' },
        gym: extras.gymTz === undefined
            ? { timezone: 'UTC', name: 'Сибиряк', address: 'Томск' }
            : extras.gymTz === null
              ? null
              : { timezone: extras.gymTz, name: 'Сибиряк', address: 'Томск' },
        coaches: (extras.coachIds ?? ['coach-1']).map((userId) => ({ userId })),
        members: (extras.memberIds ?? ['stu-1', 'stu-2']).map((userId) => ({
            userId,
        })),
        exceptions: extras.exceptions ?? [],
    },
})

describe('SchedulerTickService.runTick', () => {
    it('emits one push per recipient when a session is in the reminder window', async () => {
        const { prisma, notifications } = buildPrisma({
            slots: [session('13:00', 60)],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(1)
        // 1 coach + 2 members = 3 push rows
        expect(notifications).toHaveLength(3)
        for (const n of notifications) {
            expect((n as any).topic).toBe('Через час тренировка')
            expect((n as any).message).toContain('Утренняя')
        }
    })

    it('also reminds drop-in bookers of the class, once even if they are group members', async () => {
        const { prisma, notifications } = buildPrisma({
            slots: [session('13:00', 60)],
            bookers: ['guest-1', 'stu-1'],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        await svc.runTick(baseNow)
        // coach + 2 members + 1 guest (stu-1 deduped)
        expect(notifications).toHaveLength(4)
        expect(
            notifications.map((n) => (n as any).userId).sort(),
        ).toEqual(['coach-1', 'guest-1', 'stu-1', 'stu-2'])
        const where = prisma.dropInBooking.findMany.mock.calls[0][0].where
        expect(where.slotId).toBe('slot-1')
        expect(where.sessionDate).toEqual(
            new Date(`${baseNow.getFullYear()}-${String(baseNow.getMonth() + 1).padStart(2, '0')}-${String(baseNow.getDate()).padStart(2, '0')}T00:00:00Z`),
        )
    })

    it('nudges a member whose latest attendance is older than the threshold', async () => {
        const { prisma, notifications } = buildPrisma({})
        prisma.attendanceRecord.groupBy.mockResolvedValue([
            {
                workspaceId: 'w1',
                userId: 'u9',
                _max: { markedAt: new Date('2026-01-01T00:00:00Z') },
            },
        ])
        prisma.workspaceMember.findMany.mockResolvedValue([
            {
                userId: 'u9',
                workspaceId: 'w1',
                accessUntil: null,
                workspace: { name: 'Academy' },
            },
        ])
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.inactivityNotified).toBe(1)
        const nudge = notifications.find(
            (n: any) => n.metadata?.kind === 'member.inactive',
        )
        expect(nudge).toBeDefined()
        expect((nudge as any).userId).toBe('u9')
    })

    it('skips a session that already has a ledger entry (idempotency)', async () => {
        const { prisma, notifications } = buildPrisma({
            slots: [session('13:00', 60)],
            ledgerHasKey: (kind) => kind === 'session.reminder',
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(notifications).toHaveLength(0)
    })

    it('skips a session that is cancelled by an exception', async () => {
        const today = baseNow
        const { prisma, notifications } = buildPrisma({
            slots: [
                session('13:00', 60, {
                    exceptions: [
                        {
                            slotId: null,
                            fromDate: today,
                            untilDate: today,
                        },
                    ],
                }),
            ],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(notifications).toHaveLength(0)
    })

    it('skips sessions outside the reminder window', async () => {
        const { prisma, notifications } = buildPrisma({
            // session at 18:00 — far past now+65min from a 12:00 baseline
            slots: [session('18:00', 60)],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(notifications).toHaveLength(0)
    })

    it('emits one push per workspace member for events', async () => {
        const { prisma, notifications } = buildPrisma({
            events: [
                {
                    id: 'evt-1',
                    workspaceId: 'ws-1',
                    title: 'Open mat',
                    startAt: new Date(baseNow.getTime() + 60 * 60_000),
                    link: null,
                    gym: null,
                },
            ],
            members: [{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-3' }],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.eventsNotified).toBe(1)
        expect(notifications).toHaveLength(3)
    })

    it('warns a member whose access window closes within the lookahead', async () => {
        const { prisma, notifications } = buildPrisma({
            members: [
                {
                    id: 'm-1',
                    userId: 'u-1',
                    accessUntil: new Date(
                        baseNow.getTime() + 2 * 24 * 60 * 60_000,
                    ),
                    workspace: { name: 'BJJ Academy', timezone: 'UTC' },
                },
            ],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.accessExpiryNotified).toBe(1)
        const n = notifications.find(
            (x: any) => x.metadata?.kind === 'access.expiring',
        ) as any
        expect(n).toBeTruthy()
        expect(n.topic).toBe('Доступ скоро истекает')
        expect(n.type).toBe('PUSH')
        expect(n.message).toContain('через 2 дн.')
        expect(n.message).toContain('доступ истекает 10 мая')
        // Only ACTIVE members are queried.
        expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ status: 'ACTIVE' }),
            }),
        )
    })

    it('skips a member who opted out of access-expiry notifications', async () => {
        const { prisma, notifications } = buildPrisma({
            members: [
                {
                    id: 'm-3',
                    userId: 'u-3',
                    accessUntil: new Date(
                        baseNow.getTime() + 2 * 24 * 60 * 60_000,
                    ),
                    workspace: { name: 'BJJ Academy', timezone: 'UTC' },
                },
            ],
            optedOutUserIds: ['u-3'],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.accessExpiryNotified).toBe(0)
        expect(
            notifications.filter(
                (n: any) => n.metadata?.kind === 'access.expiring',
            ),
        ).toHaveLength(0)
    })

    it('does not re-warn an access expiry already in the ledger', async () => {
        const { prisma, notifications } = buildPrisma({
            members: [
                {
                    id: 'm-2',
                    userId: 'u-2',
                    accessUntil: new Date(
                        baseNow.getTime() + 2 * 24 * 60 * 60_000,
                    ),
                    workspace: { name: 'BJJ Academy', timezone: 'UTC' },
                },
            ],
            ledgerHasKey: (kind) => kind === 'access.expiring',
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.accessExpiryNotified).toBe(0)
        expect(
            notifications.filter(
                (n: any) => n.metadata?.kind === 'access.expiring',
            ),
        ).toHaveLength(0)
    })

    it('emits cancellation pushes to the affected group only', async () => {
        const { prisma, notifications } = buildPrisma({
            exceptions: [
                {
                    id: 'exc-1',
                    groupId: 'g-1',
                    slotId: null,
                    slot: null,
                    fromDate: baseNow,
                    untilDate: baseNow,
                    reason: 'Отпуск',
                    group: {
                        name: 'Утренняя',
                        coaches: [{ userId: 'coach-1' }],
                        members: [{ userId: 'stu-1' }, { userId: 'stu-2' }],
                    },
                },
            ],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.cancellationsNotified).toBe(1)
        expect(notifications).toHaveLength(3)
        expect((notifications[0] as any).topic).toBe('Тренировка отменена')
        expect((notifications[0] as any).message).toBe(
            'Утренняя: 8 мая (вся группа) — Отпуск',
        )
    })

    it('sends the cancellation notice to drop-in bookers of the cancelled class too', async () => {
        const { prisma, notifications } = buildPrisma({
            bookers: ['guest-1', 'stu-1'],
            exceptions: [
                {
                    id: 'exc-2',
                    groupId: 'g-1',
                    slotId: 'slot-1',
                    slot: { startTime: '19:00', dayOfWeek: 5 },
                    fromDate: baseNow,
                    untilDate: baseNow,
                    reason: null,
                    group: {
                        name: 'Утренняя',
                        coaches: [{ userId: 'coach-1' }],
                        members: [{ userId: 'stu-1' }],
                    },
                },
            ],
        })
        const svc = new SchedulerTickService(prisma as never, { notifyWorkspace: jest.fn() } as never, { emitListDelta: jest.fn() } as never)
        await svc.runTick(baseNow)
        expect(
            notifications.map((n) => (n as any).userId).sort(),
        ).toEqual(['coach-1', 'guest-1', 'stu-1'])
        expect(prisma.dropInBooking.findMany).toHaveBeenCalledWith({
            where: {
                groupId: 'g-1',
                slotId: 'slot-1',
                sessionDate: { gte: baseNow, lte: baseNow },
            },
            select: { userId: true },
        })
    })

    const goneLiveAnnouncement = () => ({
        id: 'a1',
        workspaceId: 'w1',
        title: 'Открытие зала',
        body: 'Ждём всех',
        authorId: 'author',
        pinned: false,
        publishedAt: new Date(baseNow.getTime() - 60_000), // 1 min ago
        createdAt: baseNow,
        updatedAt: baseNow,
        author: { firstname: 'Coach', lastname: null, email: 'c@x' },
    })

    it('fans out a scheduled announcement that has just gone live', async () => {
        const { prisma } = buildPrisma({})
        prisma.announcement.findMany.mockResolvedValue([goneLiveAnnouncement()])
        const notifyWorkspace = jest.fn().mockResolvedValue(1)
        const emitListDelta = jest.fn()
        const svc = new SchedulerTickService(
            prisma as never,
            { notifyWorkspace } as never,
            { emitListDelta } as never,
        )
        const summary = await svc.runTick(baseNow)
        expect(summary.scheduledAnnouncementsPublished).toBe(1)
        expect(notifyWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'w1',
                kind: 'announcement.published',
                refId: 'a1',
                feature: 'announcements',
            }),
        )
        expect(emitListDelta).toHaveBeenCalledWith(
            'w1',
            'announcements',
            'create',
            expect.objectContaining({ id: 'a1' }),
        )
    })

    it('does not re-publish an announcement already fanned out (immediate publish)', async () => {
        const { prisma } = buildPrisma({})
        prisma.announcement.findMany.mockResolvedValue([goneLiveAnnouncement()])
        prisma.notificationDispatchLog.findMany.mockResolvedValue([
            { refId: 'a1' },
        ])
        const notifyWorkspace = jest.fn()
        const emitListDelta = jest.fn()
        const svc = new SchedulerTickService(
            prisma as never,
            { notifyWorkspace } as never,
            { emitListDelta } as never,
        )
        const summary = await svc.runTick(baseNow)
        expect(summary.scheduledAnnouncementsPublished).toBe(0)
        expect(notifyWorkspace).not.toHaveBeenCalled()
        expect(emitListDelta).not.toHaveBeenCalled()
    })
})
