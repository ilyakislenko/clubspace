import {
    DEFAULT_PLATFORM_MODULES,
    DEFAULT_PLATFORM_TIERS,
} from '../platform-pricing.config'

const billingEnv = {
    enabled: true,
    trialDays: 30,
    graceDays: 7,
    pricing: {
        currency: 'RUB',
        tiers: DEFAULT_PLATFORM_TIERS,
        modules: DEFAULT_PLATFORM_MODULES,
        annualDiscountPercent: 15,
        setupFee: 4_990,
    },
}
jest.mock('../../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import { PlatformBillingService } from './platform-billing.service'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })
const NOW = new Date('2026-11-10T12:00:00.000Z')
const DAY = 86_400_000

const billingRow = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'w1',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    pastDueSince: null,
    billingPeriodMonths: 1,
    customMonthlyPrice: null,
    discountPercent: 0,
    freeUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: new Date('2026-10-01T00:00:00Z'),
    paidTierCode: 'start',
    notes: null,
    ...over,
})

const build = () => {
    const prisma = {
        workspaceBilling: {
            findUnique: jest.fn().mockResolvedValue(billingRow()),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ raced: true }),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        },
        workspace: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'w1', ownerId: 'owner' }),
        },
        workspaceMember: { groupBy: jest.fn().mockResolvedValue([]) },
        workspaceModuleEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
        video: { aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: null } }) },
        videoViewingMonth: { findUnique: jest.fn().mockResolvedValue(null) },
        $executeRaw: jest.fn().mockResolvedValue(1),
    }
    const service = new PlatformBillingService(prisma as never)
    return { service, prisma }
}

const activeMembers = (prisma: ReturnType<typeof build>['prisma'], n: number) =>
    prisma.workspaceMember.groupBy.mockResolvedValue([
        { workspaceId: 'w1', _count: { _all: n } },
    ])

afterEach(() => {
    billingEnv.enabled = true
})

describe('PlatformBillingService', () => {
    describe('getBilling', () => {
        it('returns the existing row', async () => {
            const { service, prisma } = build()
            await expect(service.getBilling('w1')).resolves.toMatchObject({ status: 'ACTIVE' })
            expect(prisma.workspaceBilling.create).not.toHaveBeenCalled()
        })

        it('starts a trial for a club that predates billing — no free plan', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            const row = await service.getBilling('w1')
            expect(row.status).toBe('TRIAL')
            const days = (row.trialEndsAt!.getTime() - Date.now()) / DAY
            expect(Math.round(days)).toBe(30)
        })

        it('reads the winner back when two requests race on the insert', async () => {
            const { service, prisma } = build()
            prisma.workspaceBilling.findUnique.mockResolvedValue(null)
            prisma.workspaceBilling.create.mockRejectedValue(p2002())
            await expect(service.getBilling('w1')).resolves.toEqual({ raced: true })
        })
    })

    it('starts a self-serve trial bound to its owner', async () => {
        const { service } = build()
        const tx = { workspaceBilling: { create: jest.fn().mockResolvedValue({}) } }
        await service.startTrial(tx as never, { workspaceId: 'w1', ownerId: 'u1', now: NOW })
        expect(tx.workspaceBilling.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            status: 'TRIAL',
            trialEndsAt: new Date(NOW.getTime() + 30 * DAY),
            trialOwnerId: 'u1',
        })
    })

    describe('countActiveMembersMany', () => {
        it('counts students active in the last 30 days, never staff, applicants or the owner', async () => {
            const { service, prisma } = build()
            activeMembers(prisma, 42)
            const result = await service.countActiveMembersMany(
                [{ id: 'w1', ownerId: 'owner' }, { id: 'w2', ownerId: 'o2' }],
                NOW,
            )
            expect(result).toEqual(new Map([['w1', 42], ['w2', 0]]))
            const since = new Date(NOW.getTime() - 30 * DAY)
            expect(prisma.workspaceMember.groupBy.mock.calls[0][0]).toEqual({
                by: ['workspaceId'],
                where: {
                    workspaceId: { in: ['w1', 'w2'] },
                    status: { not: 'INVITED' },
                    role: { name: 'user' },
                    OR: [
                        { lastAttendedAt: { gte: since } },
                        { lastSeenAt: { gte: since } },
                    ],
                    NOT: {
                        OR: [
                            { workspaceId: 'w1', userId: 'owner' },
                            { workspaceId: 'w2', userId: 'o2' },
                        ],
                    },
                },
                _count: { _all: true },
            })
        })

        it('skips the query for an empty page', async () => {
            const { service, prisma } = build()
            await expect(service.countActiveMembersMany([], NOW)).resolves.toEqual(new Map())
            expect(prisma.workspaceMember.groupBy).not.toHaveBeenCalled()
        })
    })

    describe('recordViewing', () => {
        it('adds seconds to the month with one atomic upsert', async () => {
            const { service, prisma } = build()
            await service.recordViewing('w1', 40, NOW)
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
            const values = prisma.$executeRaw.mock.calls[0].slice(1)
            expect(values).toEqual(['w1', new Date('2026-11-01T00:00:00Z'), 40])
        })

        it('writes nothing for zero', async () => {
            const { service, prisma } = build()
            await service.recordViewing('w1', 0, NOW)
            expect(prisma.$executeRaw).not.toHaveBeenCalled()
        })
    })

    describe('getState', () => {
        it('puts tier, modules, usage and the next-charge quote together', async () => {
            const { service, prisma } = build()
            activeMembers(prisma, 95)
            prisma.workspaceModuleEntitlement.findMany.mockResolvedValue([
                { module: 'VIDEO', mode: 'PAID', compUntil: null, customPrice: null },
                { module: 'BRANDED_APP', mode: 'OFF', compUntil: null, customPrice: null },
            ])
            prisma.video.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt(5 * 1024 ** 3) } })
            prisma.videoViewingMonth.findUnique.mockResolvedValue({ seconds: 7_200 })

            const state = await service.getState('w1', NOW)

            expect(state.activeMembers).toBe(95)
            expect(state.tier.code).toBe('club')
            expect(state.nextTier?.code).toBe('pro')
            expect(state.paidTier?.code).toBe('start')
            expect(state.storageBytes).toBe(5 * 1024 ** 3)
            expect(state.viewedSecondsThisMonth).toBe(7_200)
            expect(state.nextChargeAt).toEqual(new Date('2026-12-01T00:00:00Z'))
            expect(
                state.modules.map((m) => [m.pricing.code, m.entitled, m.source]),
            ).toEqual([
                ['VIDEO', true, 'PAID'],
                ['ONLINE_PAYMENTS', false, 'NONE'],
                ['BRANDED_APP', false, 'OFF'],
            ])
            expect(state.quote.lines.map((l) => [l.code, l.amount])).toEqual([
                ['tier', 5_990],
                ['module:VIDEO', 990],
            ])
            expect(state.quote.total).toBe(6_980)
        })

        it('every module is on during the trial; the quote is for the first charge after it', async () => {
            const { service, prisma } = build()
            const trialEndsAt = new Date('2026-11-25T00:00:00Z')
            prisma.workspaceBilling.findUnique.mockResolvedValue(
                billingRow({ status: 'TRIAL', trialEndsAt, currentPeriodEnd: null, setupFeePaidAt: null }),
            )
            const state = await service.getState('w1', NOW)
            expect(state.modules.every((m) => m.entitled && m.source === 'TRIAL')).toBe(true)
            expect(state.nextChargeAt).toEqual(trialEndsAt)
            // Modules not bought are not on the first bill; the setup fee is.
            expect(state.quote.lines.map((l) => l.code)).toEqual(['tier', 'setup'])
        })
    })

    describe('quoteWorkspaceBilling (the autopay contract)', () => {
        it('bills viewing of the month before the period starts', async () => {
            const { service, prisma } = build()
            prisma.workspaceModuleEntitlement.findMany.mockResolvedValue([
                { module: 'VIDEO', mode: 'PAID', compUntil: null, customPrice: null },
            ])
            prisma.videoViewingMonth.findUnique
                .mockResolvedValueOnce({ seconds: 0 }) // this month (November)
                .mockResolvedValueOnce({ seconds: 102 * 3600 }) // October
            const q = await service.quoteWorkspaceBilling('w1', {
                now: NOW,
                periodStart: new Date('2026-11-10T00:00:00Z'),
            })
            expect(prisma.videoViewingMonth.findUnique.mock.calls[1][0]).toEqual({
                where: {
                    workspaceId_month: {
                        workspaceId: 'w1',
                        month: new Date('2026-10-01T00:00:00Z'),
                    },
                },
                select: { seconds: true },
            })
            expect(q.lines.find((l) => l.code === 'overage:viewing')?.amount).toBe(10)
        })
    })
})
