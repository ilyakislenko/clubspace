import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ChangeRecordAbonementFeature } from './change-record-abonement.feature'
import { ChangeRecordAbonementHandler } from './change-record-abonement.handler'
import { buildRoster } from './roster'

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
    syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}))
// The roster read has its own spec; here it only has to come back.
jest.mock('./roster', () => ({
    buildRoster: jest.fn().mockResolvedValue({ sessionId: 'sess1', roster: [] }),
}))

beforeEach(() => {
    ;(syncFirstVisitStartInTx as jest.Mock).mockClear()
    ;(buildRoster as jest.Mock).mockClear()
})

const LIVE = new Date(Date.now() + 30 * 24 * 3600 * 1000)

// A current abonement of m1 as loadVisitCandidates reads it.
const sub = (
    id: string,
    over: {
        classesTotal?: number | null
        classesRemaining?: number | null
        directions?: string[]
        frozen?: boolean
    } = {},
) => ({
    id,
    status: 'ACTIVE',
    startDate: null,
    endDate: LIVE,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    classesTotal: over.classesTotal === undefined ? 10 : over.classesTotal,
    classesRemaining:
        over.classesRemaining === undefined ? 5 : over.classesRemaining,
    startsOnFirstVisit: false,
    plan: { name: `Plan ${id}` },
    workspaceMember: { userId: 'm1' },
    directions: (over.directions ?? []).map((d) => ({
        directionId: d,
        direction: { id: d, name: d, color: null, icon: null },
    })),
    freezes: over.frozen ? [{ id: 'fr' }] : [],
})

const groupSession = {
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: 's1',
    occurrenceKey: 'slot:s1:2026-10-24',
    workspaceEventId: null,
    checkInCode: null,
    coachId: null,
    isPersonal: false,
    startAt: new Date('2026-10-24T16:00:00Z'),
    timezone: 'Europe/Moscow',
}

const makePrisma = (o: {
    record?: { usedSubscriptionId: string | null; consumedSubscriptionId: string | null } | null
    current?: unknown[]
    // The pack being refunded, as refundConsumedClass reads it.
    old?: { id: string; classesRemaining: number; classesTotal: number }
    direction?: string | null
} = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = {
        attendanceSession: {
            findFirst: jest.fn().mockResolvedValue(groupSession),
            findUnique: jest.fn().mockResolvedValue({
                group: { directionId: o.direction ?? null },
                workspaceEvent: null,
            }),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
        },
        attendanceRecord: {
            findUnique: jest.fn().mockResolvedValue(
                o.record === undefined
                    ? { usedSubscriptionId: 'old', consumedSubscriptionId: 'old' }
                    : o.record,
            ),
        },
        subscription: {
            findMany: jest.fn().mockResolvedValue(o.current ?? []),
            findUnique: jest.fn().mockResolvedValue(
                o.old ? { status: 'ACTIVE', ...o.old } : null,
            ),
            update: jest.fn().mockResolvedValue({}),
            updateManyAndReturn: jest.fn(
                async ({ where }: { where: { id: { in: string[] } } }) =>
                    where.id.in.map((id) => ({ id, classesRemaining: 4 })),
            ),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
    }
    p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p))
    return p
}

const makeRbac = () => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: 'coach',
        userId: 'coach1',
        workspaceId: 'w1',
    }),
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    assertCanMarkClass: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    canSeeAllGroups: jest.fn().mockReturnValue(false),
})

const run = (prisma: unknown, subscriptionId: string, rbac = makeRbac()) => {
    const realtime = {
        invalidateCoalesced: jest.fn(),
        invalidateUsersInWorkspace: jest.fn(),
    }
    const followUps = { schedule: jest.fn() }
    const res = new ChangeRecordAbonementHandler(
        prisma as never,
        rbac as never,
        realtime as never,
        followUps as never,
    ).execute(
        new ChangeRecordAbonementFeature(
            { subscriptionId },
            'w1',
            'sess1',
            'm1',
            'coach1',
            'coach',
            false,
        ),
    )
    return { res, realtime, followUps, rbac }
}

// [userId, usedSubscriptionId, consumedSubscriptionId] of the tagging statement.
const tagged = (prisma: { $executeRaw: jest.Mock }) => {
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    return prisma.$executeRaw.mock.calls[0][1].values
}

describe('changeRecordAbonement', () => {
    it('refuses a coach of another group before touching anything', async () => {
        const prisma = makePrisma()
        const rbac = makeRbac()
        rbac.assertCanMarkClass.mockRejectedValue(
            new ForbiddenError({ message: 'Нет доступа к этой группе' }),
        )
        await expect(run(prisma, 'new', rbac).res).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(rbac.assertCanMarkClass).toHaveBeenCalledWith(
            expect.anything(),
            'g1',
            'slot:s1:2026-10-24',
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s an unknown session', async () => {
        const prisma = makePrisma()
        prisma.attendanceSession.findFirst.mockResolvedValue(null)
        await expect(run(prisma, 'new').res).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s a member who is not marked', async () => {
        const prisma = makePrisma({ record: null, current: [sub('new')] })
        const { res } = run(prisma, 'new')
        await expect(res).rejects.toBeInstanceOf(NotFoundError)
        await expect(res).rejects.toThrow('Отметка не найдена')
        expect(prisma.subscription.update).not.toHaveBeenCalled()
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('refuses a personal session', async () => {
        const prisma = makePrisma()
        prisma.attendanceSession.findFirst.mockResolvedValue({
            ...groupSession,
            groupId: null,
            isPersonal: true,
            coachId: 'coach1',
        })
        await expect(run(prisma, 'new').res).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('moves a visit from one pack to another: refunds the old class, draws the new one', async () => {
        const prisma = makePrisma({
            current: [sub('old', { classesRemaining: 3 }), sub('new')],
            old: { id: 'old', classesRemaining: 3, classesTotal: 10 },
        })
        const { res, followUps, realtime } = run(prisma, 'new')
        await expect(res).resolves.toEqual({ sessionId: 'sess1', roster: [] })
        expect(prisma.subscription.update).toHaveBeenCalledWith({
            where: { id: 'old' },
            data: { classesRemaining: { increment: 1 } },
        })
        expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledWith({
            where: { id: { in: ['new'] }, classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
            select: { id: true, classesRemaining: true },
        })
        expect(tagged(prisma)).toEqual(['m1', 'new', 'new'])
        // Both abonements may start on a first visit: one sync covers the member.
        expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
            workspaceId: 'w1',
            userId: 'm1',
            now: expect.any(Date),
        })
        expect(followUps.schedule).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userIds: [],
            subscriptionIds: ['new'],
        })
        expect(realtime.invalidateUsersInWorkspace).toHaveBeenCalledWith(
            ['m1'],
            'w1',
            ['attendance', 'subscription'],
        )
        expect(buildRoster).toHaveBeenCalled()
    })

    it('moves a visit to a time-based abonement: refunds the pack, deducts nothing', async () => {
        const prisma = makePrisma({
            current: [
                sub('old'),
                sub('time', { classesTotal: null, classesRemaining: null }),
            ],
            old: { id: 'old', classesRemaining: 5, classesTotal: 10 },
        })
        const { res, followUps } = run(prisma, 'time')
        await res
        expect(prisma.subscription.update).toHaveBeenCalledTimes(1)
        expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
        expect(tagged(prisma)).toEqual(['m1', 'time', null])
        expect(followUps.schedule).not.toHaveBeenCalled()
    })

    it('attributes an unattributed visit without refunding anything', async () => {
        const prisma = makePrisma({
            record: { usedSubscriptionId: null, consumedSubscriptionId: null },
            current: [sub('new')],
        })
        await run(prisma, 'new').res
        expect(prisma.subscription.findUnique).not.toHaveBeenCalled()
        expect(prisma.subscription.update).not.toHaveBeenCalled()
        expect(tagged(prisma)).toEqual(['m1', 'new', 'new'])
    })

    it('moving off a time-based abonement refunds nothing', async () => {
        const prisma = makePrisma({
            record: { usedSubscriptionId: 'time', consumedSubscriptionId: null },
            current: [
                sub('time', { classesTotal: null, classesRemaining: null }),
                sub('new'),
            ],
        })
        await run(prisma, 'new').res
        expect(prisma.subscription.update).not.toHaveBeenCalled()
        expect(tagged(prisma)).toEqual(['m1', 'new', 'new'])
    })

    it('is a no-op when the visit is already spent on that abonement', async () => {
        const prisma = makePrisma({ current: [sub('old')] })
        const { res, realtime } = run(prisma, 'old')
        await expect(res).resolves.toEqual({ sessionId: 'sess1', roster: [] })
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        expect(prisma.subscription.update).not.toHaveBeenCalled()
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
        expect(realtime.invalidateCoalesced).not.toHaveBeenCalled()
    })

    it.each([
        ['of another direction', { directions: ['mma'] }],
        ['that is frozen on the class day', { frozen: true }],
        ['with no classes left', { classesRemaining: 0 }],
    ])('refuses an abonement %s, refunding nothing', async (_name, over) => {
        const prisma = makePrisma({
            current: [sub('old'), sub('new', over)],
            old: { id: 'old', classesRemaining: 4, classesTotal: 10 },
            direction: 'bjj',
        })
        const { res } = run(prisma, 'new')
        await expect(res).rejects.toThrow(
            'Этот абонемент нельзя списать на эту тренировку',
        )
        expect(prisma.subscription.update).not.toHaveBeenCalled()
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('refuses (rolling the refund back with the transaction) when the pack’s last class went meanwhile', async () => {
        const prisma = makePrisma({
            current: [sub('old'), sub('new', { classesRemaining: 1 })],
            old: { id: 'old', classesRemaining: 4, classesTotal: 10 },
        })
        prisma.subscription.updateManyAndReturn.mockResolvedValue([])
        await expect(run(prisma, 'new').res).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
        expect(syncFirstVisitStartInTx).not.toHaveBeenCalled()
    })
})
