jest.mock('../../environments/environment', () => ({
    environment: { billing: { graceDays: 7 } },
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWorkspaceBillingFeature } from './get-workspace-billing.feature'
import { GetWorkspaceBillingHandler } from './get-workspace-billing.handler'

const PLAN = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'free',
    name: 'Free',
    priceMonthly: 0,
    currency: 'RUB',
    maxMembers: 30,
    maxCoaches: 2,
    maxStorageGb: 2,
    maxVideos: 10,
    features: ['Расписание'],
}

const build = (
    o: { denied?: boolean; ws?: unknown; billing?: Record<string, unknown> } = {},
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
        getBilling: jest.fn().mockResolvedValue({
            status: 'ACTIVE',
            trialEndsAt: null,
            currentPeriodEnd: null,
            pastDueSince: null,
            plan: PLAN,
            ...o.billing,
        }),
        getUsage: jest.fn().mockResolvedValue({
            members: 12,
            coaches: 1,
            storageBytes: 1024,
            videos: 3,
        }),
        listPlans: jest.fn().mockResolvedValue([PLAN]),
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
        expect(billing.getBilling).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('returns plan, usage, every plan and the grace period', async () => {
        const { handler } = build()
        await expect(run(handler)).resolves.toEqual({
            enabled: true,
            billing: {
                status: 'ACTIVE',
                plan: {
                    planId: PLAN.id,
                    code: 'free',
                    name: 'Free',
                    priceMonthly: 0,
                    currency: 'RUB',
                    maxMembers: 30,
                    maxCoaches: 2,
                    maxStorageGb: 2,
                    maxVideos: 10,
                    features: ['Расписание'],
                },
                trialEndsAt: null,
                currentPeriodEnd: null,
                pastDueSince: null,
                suspendsAt: null,
                usage: { members: 12, coaches: 1, storageBytes: 1024, videos: 3 },
            },
            plans: [expect.objectContaining({ code: 'free' })],
            graceDays: 7,
        })
    })

    it('tells a past-due club when it will be suspended', async () => {
        const { handler } = build({
            billing: {
                status: 'PAST_DUE',
                pastDueSince: new Date('2026-11-01T00:00:00.000Z'),
            },
        })
        const out = await run(handler)
        expect(out.billing.suspendsAt).toBe('2026-11-08T00:00:00.000Z')
    })
})
