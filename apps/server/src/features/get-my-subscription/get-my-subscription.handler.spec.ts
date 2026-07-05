import { GetMySubscriptionFeature } from './get-my-subscription.feature'
import { GetMySubscriptionHandler } from './get-my-subscription.handler'

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Безлимит месяц' },
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: new Date('2026-07-31T00:00:00Z'),
    amountPaid: 5000,
    currency: 'RUB',
    source: 'MANUAL',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
})

const run = (prisma: unknown) =>
    new GetMySubscriptionHandler(prisma as never).execute(
        new GetMySubscriptionFeature('w1', 'me'),
    )

describe('getMySubscription', () => {
    it('returns current (matching the pointer), history and accessUntil', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    subscriptionId: 's1',
                    accessUntil: new Date('2026-07-31T00:00:00Z'),
                }),
            },
            subscription: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([subRow(), subRow({ id: 's0', status: 'EXPIRED' })]),
            },
        }
        const out = await run(prisma)
        expect(out.current?.id).toBe('s1')
        expect(out.current?.planName).toBe('Безлимит месяц')
        expect(out.history).toHaveLength(2)
        expect(out.accessUntil).toBe('2026-07-31T00:00:00.000Z')
    })

    it('returns empty for someone with no member row (owner)', async () => {
        const prisma = {
            workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscription: { findMany: jest.fn() },
        }
        const out = await run(prisma)
        expect(out).toEqual({ current: null, history: [], accessUntil: null })
        expect((prisma.subscription.findMany as jest.Mock)).not.toHaveBeenCalled()
    })

    it('current is null when the pointer matches nothing', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    subscriptionId: null,
                    accessUntil: null,
                }),
            },
            subscription: {
                findMany: jest.fn().mockResolvedValue([subRow({ status: 'CANCELLED' })]),
            },
        }
        const out = await run(prisma)
        expect(out.current).toBeNull()
        expect(out.history).toHaveLength(1)
    })
})
