jest.mock('../../environments/environment', () => ({
    environment: { billing: { graceDays: 7, trialDays: 14 } },
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ListPlatformPlansFeature } from './list-platform-plans.feature'
import { ListPlatformPlansHandler } from './list-platform-plans.handler'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingInputSchema,
} from './update-platform-workspace-billing.feature'
import { UpdatePlatformWorkspaceBillingHandler } from './update-platform-workspace-billing.handler'

const PLAN_ID = '00000000-0000-4000-8000-000000000002'

const plan = (code: string) => ({
    id: PLAN_ID,
    code,
    name: code,
    priceMonthly: 0,
    currency: 'RUB',
    maxMembers: null,
    maxCoaches: null,
    maxStorageGb: null,
    maxVideos: null,
    features: [],
})

const CURRENT = {
    status: 'TRIAL',
    trialEndsAt: new Date('2026-11-05T00:00:00.000Z'),
    currentPeriodEnd: null,
    pastDueSince: null,
    plan: plan('club'),
}

const build = (o: { ws?: unknown; plan?: unknown } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { id: 'w1' }),
        },
        platformPlan: {
            findUnique: jest
                .fn()
                .mockResolvedValue('plan' in o ? o.plan : { id: PLAN_ID }),
        },
        // Echo what the handler wrote, so the result reflects the write.
        workspaceBilling: {
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                ...CURRENT,
                notes: null,
                ...data,
                plan: data.planId ? plan('pro') : CURRENT.plan,
            })),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const billing = {
        getBilling: jest.fn().mockResolvedValue(CURRENT),
        getUsage: jest.fn().mockResolvedValue({
            members: 1,
            coaches: 0,
            storageBytes: 0,
            videos: 0,
        }),
    }
    const handler = new UpdatePlatformWorkspaceBillingHandler(
        prisma as never,
        audit as never,
        billing as never,
    )
    return { handler, prisma, audit }
}

const run = (
    handler: UpdatePlatformWorkspaceBillingHandler,
    payload: Record<string, unknown>,
    isSuperAdmin = true,
) =>
    handler.execute(
        new UpdatePlatformWorkspaceBillingFeature(
            'w1',
            payload as never,
            'staff-1',
            isSuperAdmin,
        ),
    )

describe('UpdatePlatformWorkspaceBillingHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const { handler, prisma } = build()
        await expect(
            run(handler, { kind: 'suspend' }, false),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceBilling.update).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler, { kind: 'suspend' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('404s on an unknown plan', async () => {
        const { handler } = build({ plan: null })
        await expect(
            run(handler, { kind: 'changePlan', planId: PLAN_ID }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('changes the plan and audits from → to', async () => {
        const { handler, prisma, audit } = build()
        const out = await run(handler, { kind: 'changePlan', planId: PLAN_ID })
        expect(prisma.workspaceBilling.update.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: 'w1' },
            data: { planId: PLAN_ID },
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'workspace.billingUpdate',
            targetType: 'workspace',
            targetId: 'w1',
            workspaceId: 'w1',
            actorId: 'staff-1',
            metadata: {
                kind: 'changePlan',
                from: { status: 'TRIAL', plan: 'club' },
                to: { status: 'TRIAL', plan: 'pro' },
            },
        })
        expect(out.billing.plan.code).toBe('pro')
    })

    it('marks a period paid: ACTIVE with a period end', async () => {
        const { handler, prisma, audit } = build()
        const out = await run(handler, { kind: 'markPaid', days: 30 })
        const data = prisma.workspaceBilling.update.mock.calls[0][0].data
        expect(data.status).toBe('ACTIVE')
        expect(data.currentPeriodEnd).toBeInstanceOf(Date)
        expect(out.billing.status).toBe('ACTIVE')
        expect(audit.record.mock.calls[0][0].metadata.days).toBe(30)
    })

    it.each(['extendTrial', 'suspend', 'resume'] as const)(
        'applies %s',
        async (kind) => {
            const { handler, prisma } = build()
            await run(handler, { kind, days: 7 })
            const data = prisma.workspaceBilling.update.mock.calls[0][0].data
            expect(data.status).toBe(
                { extendTrial: 'TRIAL', suspend: 'SUSPENDED', resume: 'ACTIVE' }[
                    kind
                ],
            )
        },
    )

    it('stores notes, and an empty note clears them', async () => {
        const { handler, prisma } = build()
        const out = await run(handler, { kind: 'setNotes', notes: 'Счёт №12' })
        expect(prisma.workspaceBilling.update.mock.calls[0][0].data).toEqual({
            notes: 'Счёт №12',
        })
        expect(out.notes).toBe('Счёт №12')
        await run(handler, { kind: 'setNotes', notes: '' })
        expect(prisma.workspaceBilling.update.mock.calls[1][0].data).toEqual({
            notes: null,
        })
    })
})

describe('UpdatePlatformWorkspaceBillingInputSchema', () => {
    it.each([
        [{ kind: 'changePlan' }, 'planId'],
        [{ kind: 'markPaid' }, 'days'],
        [{ kind: 'extendTrial' }, 'days'],
        [{ kind: 'setNotes' }, 'notes'],
    ])('requires the field its action needs: %j', (input, field) => {
        const res = UpdatePlatformWorkspaceBillingInputSchema.safeParse(input)
        expect(res.success).toBe(false)
        expect(res.error?.issues[0].path).toEqual([field])
    })

    it('accepts a bare suspend', () => {
        expect(
            UpdatePlatformWorkspaceBillingInputSchema.safeParse({ kind: 'suspend' })
                .success,
        ).toBe(true)
    })
})

describe('ListPlatformPlansHandler', () => {
    const billing = {
        enabled: true,
        listPlans: jest.fn().mockResolvedValue([plan('free')]),
    }

    it('refuses anyone but a platform admin', async () => {
        await expect(
            new ListPlatformPlansHandler(billing as never).execute(
                new ListPlatformPlansFeature('u1', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lists the plans with the billing settings', async () => {
        await expect(
            new ListPlatformPlansHandler(billing as never).execute(
                new ListPlatformPlansFeature('u1', true),
            ),
        ).resolves.toEqual({
            billingEnabled: true,
            trialDays: 14,
            graceDays: 7,
            data: [expect.objectContaining({ planId: PLAN_ID, code: 'free' })],
        })
    })
})
