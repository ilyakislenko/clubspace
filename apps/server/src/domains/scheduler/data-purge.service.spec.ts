import { DataPurgeService, DISPATCH_LOG_RETENTION_DAYS } from './data-purge.service'

jest.mock('../../environments/environment', () => ({
    environment: { notificationRetentionDays: 90 },
}))

const NOW = new Date('2026-05-08T03:30:00Z')
const DAY = 24 * 60 * 60_000

const make = (batches: { id: string }[][] = []) => {
    const queue = [...batches]
    const prisma = {
        notification: {
            findMany: jest.fn(async () => queue.shift() ?? []),
            deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
                count: where.id.in.length,
            })),
        },
        notificationDispatchLog: {
            deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        refreshToken: {
            deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
    }
    return { prisma, svc: new DataPurgeService(prisma as never) }
}

const ids = (n: number, prefix = 'n') =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }))

describe('DataPurgeService', () => {
    it('deletes notifications past the retention window in id batches', async () => {
        const { prisma, svc } = make([ids(5000, 'a'), ids(1200, 'b')])

        const res = await svc.run(NOW)

        expect(res.notifications).toBe(6200)
        expect(prisma.notification.findMany).toHaveBeenCalledTimes(2)
        expect(prisma.notification.findMany.mock.calls[0][0]).toEqual({
            where: { createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } },
            select: { id: true },
            take: 5000,
        })
        expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(2)
    })

    it('stops when nothing is old enough', async () => {
        const { prisma, svc } = make()
        expect((await svc.run(NOW)).notifications).toBe(0)
        expect(prisma.notification.deleteMany).not.toHaveBeenCalled()
    })

    it('purges only time-bounded dispatch-log kinds, each past its own window', async () => {
        const { prisma, svc } = make()

        const res = await svc.run(NOW)

        const kinds = Object.keys(DISPATCH_LOG_RETENTION_DAYS)
        expect(res.dispatchLog).toBe(2 * kinds.length)
        const calls = prisma.notificationDispatchLog.deleteMany.mock.calls.map((c) => c[0].where)
        expect(calls.map((w) => w.kind)).toEqual(kinds)
        expect(calls[0]).toEqual({
            kind: 'session.reminder',
            dispatchedAt: { lt: new Date(NOW.getTime() - 7 * DAY) },
        })
        // One-off events must keep their key forever, or they would fire again.
        for (const permanent of ['achievement.unlocked', 'rank.promoted', 'announcement.published']) {
            expect(kinds).not.toContain(permanent)
        }
    })

    it('deletes refresh tokens only once expired (revoked ones stay for reuse detection)', async () => {
        const { prisma, svc } = make()
        expect((await svc.run(NOW)).refreshTokens).toBe(3)
        expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { expiresAt: { lt: NOW } },
        })
    })
})
