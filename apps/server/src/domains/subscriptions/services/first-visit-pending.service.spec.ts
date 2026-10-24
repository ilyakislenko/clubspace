import { syncFirstVisitStartInTx } from '../first-visit-start'
import { FirstVisitPendingService } from './first-visit-pending.service'

jest.mock('../first-visit-start', () => ({
    ...jest.requireActual('../first-visit-start'),
    syncFirstVisitStartInTx: jest.fn().mockResolvedValue('started'),
}))

beforeEach(() => (syncFirstVisitStartInTx as jest.Mock).mockClear())

const TZ = 'Asia/Tomsk' // UTC+7, no DST
// Sold at 12:00 on 24 October, Tomsk: the latest start is 7 November.
const SALE = new Date('2026-10-24T05:00:00Z')

const pendingSub = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    workspaceId: 'w1',
    createdAt: SALE,
    classesTotal: null,
    plan: { name: 'Стандарт' },
    workspace: { timezone: TZ },
    workspaceMember: { userId: 'u1' },
    ...over,
})

const make = (autoStartRows: unknown[], reminderRows: unknown[]) => {
    const tx = {}
    const prisma = {
        subscription: {
            findMany: jest
                .fn()
                .mockResolvedValueOnce(autoStartRows)
                .mockResolvedValueOnce(reminderRows),
        },
        $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const svc = new FirstVisitPendingService(prisma as never, notifications as never)
    return { svc, prisma, notifications, tx }
}

describe('FirstVisitPendingService auto-start', () => {
    const now = new Date('2026-11-07T00:00:00Z')

    it('looks for pending first-visit abonements sold 14+ days ago', async () => {
        const { svc, prisma } = make([], [])
        await svc.run(now)
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
            status: 'ACTIVE',
            startsOnFirstVisit: true,
            startDate: null,
            createdAt: { lte: new Date('2026-10-24T00:00:00Z') },
        })
    })

    it('runs the sync per member and counts the ones it started', async () => {
        const { svc, tx } = make(
            [
                { workspaceId: 'w1', workspaceMember: { userId: 'u1' } },
                { workspaceId: 'w1', workspaceMember: { userId: 'u2' } },
                { workspaceId: 'w1', workspaceMember: null },
            ],
            [],
        )
        ;(syncFirstVisitStartInTx as jest.Mock)
            .mockResolvedValueOnce('started')
            .mockResolvedValueOnce('unchanged')
        const res = await svc.run(now)
        expect(syncFirstVisitStartInTx).toHaveBeenCalledTimes(2)
        expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(tx, {
            workspaceId: 'w1',
            userId: 'u1',
            now,
        })
        expect(res.autoStarted).toBe(1)
    })

    it('carries on with the others when one member fails', async () => {
        const { svc } = make(
            [
                { workspaceId: 'w1', workspaceMember: { userId: 'u1' } },
                { workspaceId: 'w1', workspaceMember: { userId: 'u2' } },
            ],
            [],
        )
        ;(syncFirstVisitStartInTx as jest.Mock)
            .mockRejectedValueOnce(new Error('lost the race'))
            .mockResolvedValueOnce('started')
        const res = await svc.run(now)
        expect(syncFirstVisitStartInTx).toHaveBeenCalledTimes(2)
        expect(res.autoStarted).toBe(1)
    })
})

describe('FirstVisitPendingService reminders', () => {
    // Club-local 12:00 on the 27th (sale day + 3) and the 3rd of November (+10).
    const day3 = new Date('2026-10-27T05:00:00Z')
    const day10 = new Date('2026-11-03T05:00:00Z')

    it('reminds on sale day + 3 with the auto-start date', async () => {
        const { svc, notifications } = make([], [pendingSub()])
        const res = await svc.run(day3)
        expect(res.reminded).toBe(1)
        expect(notifications.notifyUser).toHaveBeenCalledWith({
            userId: 'u1',
            kind: 'subscription.first_visit_pending',
            refId: 's1:3',
            topic: 'Абонемент ждёт вас',
            message:
                'Абонемент «Стандарт» начнётся с первой тренировки — приходите! Если не придёте, он начнётся автоматически 7 ноября.',
            metadata: { subscriptionId: 's1' },
            category: 'accessExpiringEnabled',
            workspaceId: 'w1',
            feature: 'subscription',
        })
    })

    it('reminds again on sale day + 10', async () => {
        const { svc, notifications } = make([], [pendingSub()])
        await svc.run(day10)
        expect(notifications.notifyUser.mock.calls[0][0].refId).toBe('s1:10')
    })

    it('is silent on the other days', async () => {
        const { svc, notifications } = make([], [pendingSub()])
        await svc.run(new Date('2026-10-28T05:00:00Z'))
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it.each([
        ['09:59', '2026-10-27T02:59:00Z'],
        ['21:00', '2026-10-27T14:00:00Z'],
    ])('stays quiet outside 10:00-21:00 club time (%s)', async (_label, iso) => {
        const { svc, notifications } = make([], [pendingSub()])
        await svc.run(new Date(iso))
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('does not count a reminder the dedupe ledger already holds', async () => {
        const { svc, notifications } = make([], [pendingSub()])
        notifications.notifyUser.mockResolvedValue(false)
        const res = await svc.run(day3)
        expect(res.reminded).toBe(0)
    })
})
