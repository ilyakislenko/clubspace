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
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: IN_30_DAYS,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: {
                findFirst: jest.fn().mockResolvedValue(null),
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
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: {
                findFirst: jest.fn().mockResolvedValue(null),
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
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: {
                findFirst: jest.fn().mockResolvedValue(null),
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
        expect(out).toEqual({
            current: null,
            history: [],
            accessUntil: null,
            freeze: null,
            coach: null,
        })
        expect((prisma.subscription.findMany as jest.Mock)).not.toHaveBeenCalled()
    })

    it('current is null when the pointer matches nothing', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: null,
                    accessUntil: null,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            subscription: {
                findMany: jest.fn().mockResolvedValue([subRow({ status: 'CANCELLED' })]),
            },
        }
        const out = await run(prisma)
        expect(out.current).toBeNull()
        expect(out.history).toHaveLength(1)
    })

    it('returns the open freeze of the current abonement', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'f1',
                    subscriptionId: 's1',
                    fromDate: new Date('2999-10-24T00:00:00Z'),
                    untilDate: new Date('2999-10-30T00:00:00Z'),
                    reason: 'Травма',
                    endedEarlyAt: null,
                    createdAt: new Date('2026-10-24T09:00:00Z'),
                }),
            },
            subscription: {
                findMany: jest.fn().mockResolvedValue([subRow()]),
            },
        }
        const out = await run(prisma)
        expect(prisma.subscriptionFreeze.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ subscriptionId: 's1' }),
            }),
        )
        expect(out.freeze).toMatchObject({
            id: 'f1',
            fromDate: '2999-10-24',
            untilDate: '2999-10-30',
            days: 7,
            reason: 'Травма',
        })
    })

    it('has no freeze when there is no current abonement', async () => {
        const prisma = {
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
            subscriptionFreeze: { findFirst: jest.fn() },
            subscription: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([subRow({ endDate: A_DAY_AGO })]),
            },
        }
        const out = await run(prisma)
        expect(out.freeze).toBeNull()
        expect(prisma.subscriptionFreeze.findFirst).not.toHaveBeenCalled()
    })

    describe('coach', () => {
        const withCoach = (coach: Record<string, unknown> | null) => ({
            workspaceMember: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'wm1',
                    workspace: { timezone: 'Europe/Moscow' },
                    subscriptionId: 's1',
                    accessUntil: null,
                }),
            },
            groupMember: {
                findFirst: jest.fn().mockResolvedValue(
                    coach
                        ? { group: { workspace: { ownerId: 'owner' }, coach } }
                        : null,
                ),
            },
            subscriptionFreeze: { findFirst: jest.fn().mockResolvedValue(null) },
            subscription: { findMany: jest.fn().mockResolvedValue([subRow()]) },
        })

        it('returns the name and phone of the group coach (the owner needs no member row)', async () => {
            const out = await run(
                withCoach({
                    id: 'owner',
                    firstname: 'Илья',
                    lastname: 'Кислов',
                    phone: '+79528849420',
                    status: 'ACTIVE',
                }),
            )
            expect(out.coach).toEqual({
                name: 'Кислов Илья',
                phone: '+79528849420',
            })
        })

        it('is null when the member has no group', async () => {
            expect((await run(withCoach(null))).coach).toBeNull()
        })

        it('is null for a coach without a name (never falls back to e-mail)', async () => {
            const out = await run(
                withCoach({
                    id: 'owner',
                    firstname: null,
                    lastname: null,
                    phone: '+79528849420',
                    status: 'ACTIVE',
                }),
            )
            expect(out.coach).toBeNull()
        })
    })
})
