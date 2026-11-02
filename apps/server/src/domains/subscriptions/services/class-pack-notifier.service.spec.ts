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

// `current` = how many current abonements the member holds.
const row = (classesRemaining: number, current = 1) => ({
    id: 'sub1',
    classesRemaining,
    plan: { name: 'БЖЖ 12 занятий' },
    workspace: { type: 'GRAPPLING' },
    workspaceMember: {
        userId: 'u1',
        _count: { subscriptions: current },
    },
})

describe('ClassPackNotifierService', () => {
    it('does nothing without subscriptions', async () => {
        const { prisma, svc } = make([])
        await svc.notifyLowOrExhausted([], 'w1')
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('counts the member’s current abonements to decide whether to name it', async () => {
        const { prisma, svc } = make([])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        const args = prisma.subscription.findMany.mock.calls[0][0]
        expect(args.where).toEqual({
            id: { in: ['sub1'] },
            classesRemaining: { in: [0, 1] },
        })
        expect(
            args.select.workspaceMember.select._count.select.subscriptions.where,
        ).toMatchObject({ status: 'ACTIVE' })
    })

    it('sends classes.low at 1 left', async () => {
        const { notifications, svc } = make([row(1)])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                kind: 'classes.low',
                refId: 'sub1:1',
                message: 'На вашем абонементе осталось последнее занятие.',
                workspaceId: 'w1',
                category: 'accessExpiringEnabled',
            }),
        )
    })

    it('sends classes.exhausted at 0 left', async () => {
        const { notifications, svc } = make([row(0)])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'classes.exhausted',
                refId: 'sub1:0',
                message:
                    'Абонемент израсходован. Оформите новый, чтобы продолжить ходить на тренировки.',
            }),
        )
    })

    it('names the abonement when the member holds several', async () => {
        const { notifications, svc } = make([row(1, 2)])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser.mock.calls[0][0].message).toBe(
            'На абонементе «БЖЖ 12 занятий» осталось последнее занятие.',
        )

        const out = make([row(0, 3)])
        await out.svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(out.notifications.notifyUser.mock.calls[0][0].message).toBe(
            'Абонемент «БЖЖ 12 занятий» израсходован. Оформите новый, чтобы продолжить ходить на тренировки.',
        )
    })

    it('says «занятия» in a dance studio', async () => {
        const { notifications, svc } = make([{ ...row(0), workspace: { type: 'DANCE' } }])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser.mock.calls[0][0].message).toBe(
            'Абонемент израсходован. Оформите новый, чтобы продолжить ходить на занятия.',
        )
    })

    it('skips a pack with no owning member', async () => {
        const { notifications, svc } = make([
            { ...row(0), workspaceMember: null },
        ])
        await svc.notifyLowOrExhausted(['sub1'], 'w1')
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })
})
