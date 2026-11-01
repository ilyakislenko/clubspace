jest.mock('../../environments/environment', () => ({
    environment: {
        billing: {
            graceDays: 7,
            pricing: {
                tiers: [
                    { code: 'start', name: 'Старт', upTo: 50, priceMonthly: 2990, extraMemberPrice: 0 },
                    { code: 'club', name: 'Клуб', upTo: null, priceMonthly: 5990, extraMemberPrice: 35 },
                ],
                annualDiscountPercent: 15,
                setupFee: 4990,
            },
        },
    },
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWorkspaceBillingFeature } from './get-workspace-billing.feature'
import { GetWorkspaceBillingHandler } from './get-workspace-billing.handler'

const START = { code: 'start', name: 'Старт', upTo: 50, priceMonthly: 2990, extraMemberPrice: 0 }
const CLUB = { code: 'club', name: 'Клуб', upTo: null, priceMonthly: 5990, extraMemberPrice: 35 }
const video = {
    code: 'VIDEO',
    name: 'Видео',
    priceMonthly: 990,
    includes: ['20 ГБ'],
    includedStorageGb: 20,
    includedViewHours: 100,
    extraStorageGbPrice: 10,
    extraViewHourPrice: 5,
}
const QUOTE = {
    lines: [{ code: 'tier', title: 'Тариф «Старт»', amount: 2990 }],
    subtotal: 2990,
    discount: 0,
    discounts: [],
    total: 2990,
    currency: 'RUB',
    periodMonths: 1,
    tierCode: 'start',
}

const state = (row: Record<string, unknown> = {}) => ({
    row: {
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
        pastDueSince: null,
        billingPeriodMonths: 1,
        freeUntil: null,
        setupFeeWaived: false,
        setupFeePaidAt: null,
        ...row,
    },
    activeMembers: 47,
    tier: START,
    nextTier: CLUB,
    paidTier: null,
    modules: [
        {
            pricing: video,
            mode: 'COMP',
            compUntil: new Date('2027-01-01T00:00:00.000Z'),
            customPrice: null,
            entitled: true,
            source: 'COMP',
        },
    ],
    storageBytes: 1024,
    viewedSecondsThisMonth: 3600,
    nextChargeAt: new Date('2026-12-01T00:00:00.000Z'),
    quote: QUOTE,
})

const build = (
    o: { denied?: boolean; ws?: unknown; row?: Record<string, unknown> } = {},
) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { id: 'w1' }),
        },
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const billing = {
        enabled: true,
        getState: jest.fn().mockResolvedValue(state(o.row)),
    }
    const handler = new GetWorkspaceBillingHandler(
        prisma as never,
        rbac as never,
        billing as never,
    )
    return { handler, billing }
}

const run = (handler: GetWorkspaceBillingHandler) =>
    handler.execute(new GetWorkspaceBillingFeature('w1', 'u1', 'coach', false))

describe('GetWorkspaceBillingHandler', () => {
    it('refuses a coach (workspace-admin only)', async () => {
        const { handler, billing } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(billing.getState).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('returns active members, tier, modules, usage, the quote and every tier', async () => {
        const { handler } = build()
        const out = await run(handler)
        expect(out).toMatchObject({
            enabled: true,
            graceDays: 7,
            annualDiscountPercent: 15,
            tiers: [START, CLUB],
        })
        expect(out.billing).toEqual({
            status: 'ACTIVE',
            trialEndsAt: null,
            currentPeriodEnd: '2026-12-01T00:00:00.000Z',
            pastDueSince: null,
            suspendsAt: null,
            freeUntil: null,
            activeMembers: 47,
            tier: { code: 'start', name: 'Старт', upTo: 50 },
            billingPeriodMonths: 1,
            nextChargeAt: '2026-12-01T00:00:00.000Z',
            nextTier: { code: 'club', name: 'Клуб', upTo: null },
            paidTier: null,
            modules: [
                {
                    code: 'VIDEO',
                    name: 'Видео',
                    priceMonthly: 990,
                    defaultPriceMonthly: 990,
                    includes: ['20 ГБ'],
                    mode: 'COMP',
                    compUntil: '2027-01-01T00:00:00.000Z',
                    customPrice: null,
                    entitled: true,
                    source: 'COMP',
                },
            ],
            videoUsage: {
                storageBytes: 1024,
                includedStorageGb: 20,
                viewedSecondsThisMonth: 3600,
                includedViewHours: 100,
            },
            setupFee: { amount: 4990, waived: false, paidAt: null },
            quote: QUOTE,
        })
    })

    it('tells a past-due club when it will be suspended', async () => {
        const { handler } = build({
            row: {
                status: 'PAST_DUE',
                pastDueSince: new Date('2026-11-01T00:00:00.000Z'),
            },
        })
        const out = await run(handler)
        expect(out.billing.suspendsAt).toBe('2026-11-08T00:00:00.000Z')
    })
})
