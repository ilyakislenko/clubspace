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
    ledgerHasKey: (kind: string, refId: string) => boolean
}> = {}) => {
    const slots = overrides.slots ?? []
    const events = overrides.events ?? []
    const exceptions = overrides.exceptions ?? []
    const members = overrides.members ?? []
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
        scheduleException: {
            findMany: jest.fn().mockResolvedValue(exceptions),
        },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue(members),
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
        const svc = new SchedulerTickService(prisma as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(1)
        // 1 coach + 2 members = 3 push rows
        expect(notifications).toHaveLength(3)
        for (const n of notifications) {
            expect((n as any).topic).toBe('Через час тренировка')
            expect((n as any).message).toContain('Утренняя')
        }
    })

    it('skips a session that already has a ledger entry (idempotency)', async () => {
        const { prisma, notifications } = buildPrisma({
            slots: [session('13:00', 60)],
            ledgerHasKey: (kind) => kind === 'session.reminder',
        })
        const svc = new SchedulerTickService(prisma as never)
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
        const svc = new SchedulerTickService(prisma as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.sessionsNotified).toBe(0)
        expect(notifications).toHaveLength(0)
    })

    it('skips sessions outside the reminder window', async () => {
        const { prisma, notifications } = buildPrisma({
            // session at 18:00 — far past now+65min from a 12:00 baseline
            slots: [session('18:00', 60)],
        })
        const svc = new SchedulerTickService(prisma as never)
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
        const svc = new SchedulerTickService(prisma as never)
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
                    workspace: { name: 'BJJ Academy' },
                },
            ],
        })
        const svc = new SchedulerTickService(prisma as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.accessExpiryNotified).toBe(1)
        const n = notifications.find(
            (x: any) => x.metadata?.kind === 'access.expiring',
        ) as any
        expect(n).toBeTruthy()
        expect(n.topic).toBe('Доступ скоро истекает')
        expect(n.type).toBe('PUSH')
        expect(n.message).toContain('через 2 дн.')
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
                    workspace: { name: 'BJJ Academy' },
                },
            ],
            ledgerHasKey: (kind) => kind === 'access.expiring',
        })
        const svc = new SchedulerTickService(prisma as never)
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
        const svc = new SchedulerTickService(prisma as never)
        const summary = await svc.runTick(baseNow)
        expect(summary.cancellationsNotified).toBe(1)
        expect(notifications).toHaveLength(3)
        expect((notifications[0] as any).topic).toBe('Тренировка отменена')
    })
})
