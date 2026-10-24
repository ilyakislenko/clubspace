import { ClassPackNotifierService } from './class-pack-notifier.service'

const make = (rows: unknown[]) => {
    const prisma = {
        subscription: { findMany: jest.fn().mockResolvedValue(rows) },
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) }
    const svc = new ClassPackNotifierService(
        prisma as never,
        notifications as never,
    )
    return { prisma, notifications, svc }
}

describe('ClassPackNotifierService', () => {
    it('does nothing without subscriptions', async () => {
        const { prisma, svc } = make([])
        await svc.notifyLowOrExhausted([], 'w1')
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('sends classes.low at 1 left', async () => {
        const { notifications, svc } = make([
            { id: 'sub1', classesRemaining: 1, workspaceMember: { userId: 'u1' } },
        ])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                kind: 'classes.low',
                refId: 'sub1:1',
                workspaceId: 'w1',
                category: 'accessExpiringEnabled',
            }),
        )
    })

    it('sends classes.exhausted at 0 left', async () => {
        const { notifications, svc } = make([
            { id: 'sub1', classesRemaining: 0, workspaceMember: { userId: 'u1' } },
        ])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'classes.exhausted',
                refId: 'sub1:0',
            }),
        )
    })

    it('skips a pack with no owning member', async () => {
        const { notifications, svc } = make([
            { id: 'sub1', classesRemaining: 0, workspaceMember: null },
        ])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })
})
