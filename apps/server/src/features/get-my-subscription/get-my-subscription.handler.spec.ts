import { GetMySubscriptionFeature } from './get-my-subscription.feature'
import { GetMySubscriptionHandler } from './get-my-subscription.handler'

// Dates are relative to "now" on purpose: a fixed 2026-07-31 endDate silently
// became "expired" once the calendar passed it, which is exactly the state this
// handler now distinguishes.
const IN_30_DAYS = new Date(Date.now() + 30 * 24 * 3600 * 1000)
const A_DAY_AGO = new Date(Date.now() - 24 * 3600 * 1000)

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Безлимит месяц' },
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: IN_30_DAYS,
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
                    accessUntil: IN_30_DAYS,
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
        expect(out.accessUntil).toBe(IN_30_DAYS.toISOString())
    })

    // The pointer outlives the row it points at, so the member's own screen
    // used to show a dead pack as their live abonement.
    it('does not report an expired pack as current, but keeps it in history', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            subscription: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([subRow({ endDate: A_DAY_AGO })]),
            },
        }
        const out = await run(prisma)
        expect(out.current).toBeNull()
        expect(out.history).toHaveLength(1)
    })

    it('does not report a cancelled pack as current', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            subscription: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([subRow({ status: 'CANCELLED' })]),
            },
        }
        const out = await run(prisma)
        expect(out.current).toBeNull()
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
