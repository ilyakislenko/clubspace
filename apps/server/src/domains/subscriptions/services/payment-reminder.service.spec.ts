import { PaymentReminderService } from './payment-reminder.service'

const TZ = 'Asia/Tomsk' // UTC+7
// Started 22 Oct (Tomsk midnight); "now" is 24 Oct 12:00 Tomsk = start+2 -> k=0.
const START = new Date('2026-10-21T17:00:00Z')
const NOW = new Date('2026-10-24T05:00:00Z')

const sub = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    workspaceId: 'w1',
    startDate: START,
    plan: { name: '12 занятий' },
    workspace: { timezone: TZ },
    workspaceMember: { userId: 'u1' },
    ...over,
})

const make = (rows: unknown[], logged: string[] = []) => {
    const prisma = {
        subscription: { findMany: jest.fn().mockResolvedValue(rows) },
        notificationDispatchLog: {
            findMany: jest
                .fn()
                .mockResolvedValue(logged.map((refId) => ({ refId }))),
        },
        attendanceRecord: {
            findMany: jest.fn().mockResolvedValue([
                { session: { startAt: new Date('2026-10-22T05:00:00Z') } },
            ]),
        },
        subscriptionFreeze: { findFirst: jest.fn().mockResolvedValue(null) },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue({ id: 'cm1' }),
        },
        groupMember: {
            findFirst: jest.fn().mockResolvedValue({
                group: {
                    workspace: { ownerId: 'owner1' },
                    coach: {
                        id: 'c1',
                        firstname: 'Роман',
                        lastname: 'Чертовских',
                        phone: '+79528849420',
                        status: 'ACTIVE',
                    },
                },
            }),
        },
    }
    const notifications = {
        notifyUser: jest.fn().mockResolvedValue(true),
        canNotifyUser: jest.fn().mockResolvedValue(true),
    }
    const svc = new PaymentReminderService(prisma as never, notifications as never)
    return { svc, prisma, notifications }
}

describe('PaymentReminderService', () => {
    it('queries started, live, unpaid abonements of active members', async () => {
        const { svc, prisma } = make([])
        await svc.dispatchDue(NOW)
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
            isPaid: false,
            status: 'ACTIVE',
            // Nothing is due after day 10: a 12-day lower bound keeps the scan small.
            startDate: {
                not: null,
                gte: new Date('2026-10-12T05:00:00Z'),
                lte: NOW,
            },
            amountPaid: { gt: 0 },
            plan: { isFreeTrial: false },
            OR: [{ endDate: null }, { endDate: { gt: NOW } }],
            workspaceMember: { is: { status: 'ACTIVE' } },
        })
    })

    it('sends the due reminder with the coach and the visits', async () => {
        const { svc, notifications } = make([sub()])
        expect(await svc.dispatchDue(NOW)).toBe(1)
        const arg = notifications.notifyUser.mock.calls[0][0]
        expect(arg).toMatchObject({
            userId: 'u1',
            kind: 'subscription.payment_due',
            refId: 's1:0',
            topic: 'Ожидание оплаты абонемента',
            metadata: { subscriptionId: 's1', workspaceId: 'w1' },
            category: 'accessExpiringEnabled',
            workspaceId: 'w1',
            feature: 'subscription',
        })
        expect(arg.message).toContain('Чертовских')
        expect(arg.message).toContain('+7 952 884-94-20')
        expect(arg.message).toContain('Визиты по абонементу: 22.10.')
    })

    it('stays silent outside the reminder hours', async () => {
        const { svc, notifications, prisma } = make([sub()])
        // 02:00 Tomsk
        expect(await svc.dispatchDue(new Date('2026-10-23T19:00:00Z'))).toBe(0)
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(prisma.notificationDispatchLog.findMany).not.toHaveBeenCalled()
    })

    it('stays silent on a day with no reminder due', async () => {
        const { svc, notifications } = make([sub()])
        // start+13: all four reminders (start+1, +4, +7, +10 and their gaps) are past
        expect(await svc.dispatchDue(new Date('2026-11-04T05:00:00Z'))).toBe(0)
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('skips a reminder that is already logged', async () => {
        const { svc, notifications, prisma } = make([sub()], ['s1:0'])
        expect(await svc.dispatchDue(NOW)).toBe(0)
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
    })

    it('does not count a reminder the producer suppressed', async () => {
        const { svc, notifications } = make([sub()])
        notifications.notifyUser.mockResolvedValue(false)
        expect(await svc.dispatchDue(NOW)).toBe(0)
    })

    it('checks the opt-out gates before the coach and visit lookups', async () => {
        const { svc, notifications, prisma } = make([sub()])
        notifications.canNotifyUser.mockResolvedValue(false)
        expect(await svc.dispatchDue(NOW)).toBe(0)
        expect(notifications.canNotifyUser).toHaveBeenCalledWith({
            userId: 'u1',
            category: 'accessExpiringEnabled',
            workspaceId: 'w1',
            feature: 'subscription',
        })
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('skips an abonement that is frozen on the club-local today', async () => {
        const { svc, notifications, prisma } = make([sub()])
        prisma.subscriptionFreeze.findFirst.mockResolvedValue({ id: 'f1' })
        expect(await svc.dispatchDue(NOW)).toBe(0)
        const where = prisma.subscriptionFreeze.findFirst.mock.calls[0][0].where
        expect(where.subscriptionId).toBe('s1')
        // 24 Oct Tomsk
        expect(where.fromDate).toEqual({ lte: new Date('2026-10-24T00:00:00Z') })
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled()
    })

    it('lists only visits not spent on another abonement', async () => {
        const { svc, prisma } = make([sub()])
        await svc.dispatchDue(NOW)
        expect(
            prisma.attendanceRecord.findMany.mock.calls[0][0].where.OR,
        ).toEqual([
            { consumedSubscriptionId: null },
            { consumedSubscriptionId: 's1' },
        ])
    })

    it('ignores a row without a member user or start', async () => {
        const { svc, notifications } = make([
            sub({ workspaceMember: null }),
            sub({ id: 's2', startDate: null }),
        ])
        expect(await svc.dispatchDue(NOW)).toBe(0)
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })
})
