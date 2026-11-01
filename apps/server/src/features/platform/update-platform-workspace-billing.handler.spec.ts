jest.mock('../../environments/environment', () => ({
    environment: {
        billing: {
            enabled: true,
            graceDays: 7,
            trialDays: 30,
            pricing: {
                tiers: [
                    { code: 'start', name: 'Старт', upTo: 50, priceMonthly: 2990, extraMemberPrice: 0 },
                    { code: 'club', name: 'Клуб', upTo: null, priceMonthly: 5990, extraMemberPrice: 0 },
                ],
            },
        },
    },
}))
// The card every console action answers with is loaded by one shared helper;
// what matters here is that the action wrote and audited the right thing.
jest.mock('./platform-workspace-billing-view', () => ({
    loadPlatformWorkspaceBilling: jest.fn().mockResolvedValue({ card: true }),
}))

import {
    ForbiddenError,
    ModuleNotEntitledError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetPlatformWorkspaceBillingFeature } from './get-platform-workspace-billing.feature'
import { GetPlatformWorkspaceBillingHandler } from './get-platform-workspace-billing.handler'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import { SetPlatformWorkspaceFeatureFeature } from './set-platform-workspace-feature.feature'
import { SetPlatformWorkspaceFeatureHandler } from './set-platform-workspace-feature.handler'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingInputSchema,
} from './update-platform-workspace-billing.feature'
import { UpdatePlatformWorkspaceBillingHandler } from './update-platform-workspace-billing.handler'
import {
    UpdatePlatformWorkspaceModuleFeature,
    UpdatePlatformWorkspaceModuleInputSchema,
} from './update-platform-workspace-module.feature'
import { UpdatePlatformWorkspaceModuleHandler } from './update-platform-workspace-module.handler'

const CURRENT = {
    workspaceId: 'w1',
    status: 'TRIAL',
    trialEndsAt: new Date('2026-11-05T00:00:00.000Z'),
    currentPeriodEnd: null,
    pastDueSince: null,
    billingPeriodMonths: 1,
    customMonthlyPrice: null,
    discountPercent: 0,
    freeUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: null,
    paidTierCode: null,
    notes: null,
}

const build = (o: { ws?: unknown; active?: number } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { id: 'w1', ownerId: 'owner' }),
            update: jest.fn().mockResolvedValue({}),
        },
        // Echo what the handler wrote, so the audit reflects the write.
        workspaceBilling: {
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                ...CURRENT,
                ...data,
            })),
        },
        workspaceModuleEntitlement: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const billing = {
        getBilling: jest.fn().mockResolvedValue(CURRENT),
        countActiveMembersMany: jest
            .fn()
            .mockResolvedValue(new Map([['w1', o.active ?? 10]])),
    }
    const modules = { assertEntitled: jest.fn().mockResolvedValue(undefined) }
    return { prisma, audit, billing, modules }
}

type Deps = ReturnType<typeof build>

const runBilling = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new UpdatePlatformWorkspaceBillingHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
    ).execute(
        new UpdatePlatformWorkspaceBillingFeature('w1', payload as never, 'staff-1', isSuperAdmin),
    )

describe('UpdatePlatformWorkspaceBillingHandler', () => {
    it('refuses anyone but a platform admin (a club admin included)', async () => {
        const d = build()
        await expect(runBilling(d, { kind: 'setDiscount', discountPercent: 50 }, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(d.prisma.workspaceBilling.update).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(runBilling(d, { kind: 'suspend' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('marks a period paid: ACTIVE, records the tier and the setup fee, audits from → to', async () => {
        const d = build({ active: 70 })
        const out = await runBilling(d, { kind: 'markPaid', days: 30 })
        const data = d.prisma.workspaceBilling.update.mock.calls[0][0].data
        expect(data).toMatchObject({ status: 'ACTIVE', paidTierCode: 'club', pastDueSince: null })
        expect(data.currentPeriodEnd).toBeInstanceOf(Date)
        expect(data.setupFeePaidAt).toBeInstanceOf(Date)
        const meta = d.audit.record.mock.calls[0][0].metadata
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.billingUpdate',
            workspaceId: 'w1',
            actorId: 'staff-1',
        })
        expect(meta).toMatchObject({
            kind: 'markPaid',
            days: 30,
            from: { status: 'TRIAL', paidTierCode: null },
            to: { status: 'ACTIVE', paidTierCode: 'club' },
        })
        expect(out).toEqual({ card: true })
        expect(loadPlatformWorkspaceBilling).toHaveBeenCalled()
    })

    it.each([
        [{ kind: 'setCustomPrice', customMonthlyPrice: 4500 }, { customMonthlyPrice: 4500 }],
        [{ kind: 'setCustomPrice', customMonthlyPrice: null }, { customMonthlyPrice: null }],
        [{ kind: 'setDiscount', discountPercent: 20 }, { discountPercent: 20 }],
        [{ kind: 'setSetupFeeWaived', setupFeeWaived: true }, { setupFeeWaived: true }],
        [{ kind: 'setBillingPeriod', billingPeriodMonths: 12 }, { billingPeriodMonths: 12 }],
        [{ kind: 'setNotes', notes: '  Счёт №12 ' }, { notes: 'Счёт №12' }],
        [{ kind: 'setNotes', notes: '' }, { notes: null }],
        [{ kind: 'setFreeUntil', freeUntil: null }, { freeUntil: null }],
    ])('writes the override %j', async (payload, data) => {
        const d = build()
        await runBilling(d, payload)
        expect(d.prisma.workspaceBilling.update.mock.calls[0][0]).toEqual({
            where: { workspaceId: 'w1' },
            data,
        })
        expect(d.audit.record.mock.calls[0][0].metadata.to).toEqual(data)
    })

    it('a free period is stored through the end of that Moscow day', async () => {
        const d = build()
        await runBilling(d, { kind: 'setFreeUntil', freeUntil: '2027-01-31' })
        expect(d.prisma.workspaceBilling.update.mock.calls[0][0].data.freeUntil).toEqual(
            new Date('2027-01-31T20:59:59.999Z'),
        )
    })

    it.each(['extendTrial', 'extendPeriod', 'suspend', 'resume'] as const)('applies %s', async (kind) => {
        const d = build()
        await runBilling(d, { kind, days: 7 })
        expect(d.prisma.workspaceBilling.update.mock.calls[0][0].data.status).toBe(
            { extendTrial: 'TRIAL', extendPeriod: 'ACTIVE', suspend: 'SUSPENDED', resume: 'ACTIVE' }[kind],
        )
    })
})

describe('UpdatePlatformWorkspaceBillingInputSchema', () => {
    it.each([
        [{ kind: 'markPaid' }, 'days'],
        [{ kind: 'extendPeriod' }, 'days'],
        [{ kind: 'setNotes' }, 'notes'],
        [{ kind: 'setCustomPrice' }, 'customMonthlyPrice'],
        [{ kind: 'setDiscount' }, 'discountPercent'],
        [{ kind: 'setFreeUntil' }, 'freeUntil'],
        [{ kind: 'setSetupFeeWaived' }, 'setupFeeWaived'],
        [{ kind: 'setBillingPeriod' }, 'billingPeriodMonths'],
    ])('requires the field its action needs: %j', (input, field) => {
        const res = UpdatePlatformWorkspaceBillingInputSchema.safeParse(input)
        expect(res.success).toBe(false)
        expect(res.error?.issues[0].path).toEqual([field])
    })

    it('refuses a discount over 100 % and a 3-month period', () => {
        expect(
            UpdatePlatformWorkspaceBillingInputSchema.safeParse({ kind: 'setDiscount', discountPercent: 101 })
                .success,
        ).toBe(false)
        expect(
            UpdatePlatformWorkspaceBillingInputSchema.safeParse({ kind: 'setBillingPeriod', billingPeriodMonths: 3 })
                .success,
        ).toBe(false)
    })
})

const runModule = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new UpdatePlatformWorkspaceModuleHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
    ).execute(new UpdatePlatformWorkspaceModuleFeature('w1', payload as never, 'staff-1', isSuperAdmin))

describe('UpdatePlatformWorkspaceModuleHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const d = build()
        await expect(runModule(d, { module: 'VIDEO', mode: 'PAID' }, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(d.prisma.workspaceModuleEntitlement.create).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(runModule(d, { module: 'VIDEO', mode: 'PAID' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('creates a comp through the end of the date and audits from → to', async () => {
        const d = build()
        await runModule(d, { module: 'VIDEO', mode: 'COMP', compUntil: '2027-03-01' })
        expect(d.prisma.workspaceModuleEntitlement.create).toHaveBeenCalledWith({
            data: {
                workspaceId: 'w1',
                module: 'VIDEO',
                mode: 'COMP',
                compUntil: new Date('2027-03-01T20:59:59.999Z'),
                customPrice: null,
            },
        })
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.moduleUpdate',
            metadata: {
                module: 'VIDEO',
                from: { mode: 'DEFAULT' },
                to: { mode: 'COMP', compUntil: '2027-03-01' },
            },
        })
    })

    it('updates an existing row with a custom price; DEFAULT removes it', async () => {
        const d = build()
        d.prisma.workspaceModuleEntitlement.updateMany.mockResolvedValue({ count: 1 })
        await runModule(d, { module: 'ONLINE_PAYMENTS', mode: 'PAID', customPrice: 300 })
        expect(d.prisma.workspaceModuleEntitlement.updateMany.mock.calls[0][0]).toEqual({
            where: { workspaceId: 'w1', module: 'ONLINE_PAYMENTS' },
            data: { mode: 'PAID', compUntil: null, customPrice: 300 },
        })
        expect(d.prisma.workspaceModuleEntitlement.create).not.toHaveBeenCalled()

        await runModule(d, { module: 'ONLINE_PAYMENTS', mode: 'DEFAULT' })
        expect(d.prisma.workspaceModuleEntitlement.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', module: 'ONLINE_PAYMENTS' },
        })
    })

    it('a comp needs its date', () => {
        expect(
            UpdatePlatformWorkspaceModuleInputSchema.safeParse({ module: 'VIDEO', mode: 'COMP' }).success,
        ).toBe(false)
    })
})

const runFeature = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new SetPlatformWorkspaceFeatureHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
        d.modules as never,
    ).execute(new SetPlatformWorkspaceFeatureFeature('w1', payload as never, 'staff-1', isSuperAdmin))

describe('SetPlatformWorkspaceFeatureHandler', () => {
    const flags = {
        announcementsEnabled: true,
        ranksEnabled: true,
        leaderboardEnabled: true,
        attendanceEnabled: true,
        subscriptionEnabled: true,
        scheduleEnabled: true,
        groupsEnabled: true,
        eventsEnabled: true,
        guestVisitsEnabled: true,
        videosEnabled: false,
        achievementsEnabled: true,
        journalEnabled: true,
    }

    it('refuses anyone but a platform admin', async () => {
        const d = build({ ws: flags })
        await expect(runFeature(d, { feature: 'events', enabled: false }, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(d.prisma.workspace.update).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(runFeature(d, { feature: 'events', enabled: false })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('flips the club column and audits it', async () => {
        const d = build({ ws: flags })
        await runFeature(d, { feature: 'events', enabled: false })
        expect(d.prisma.workspace.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: { eventsEnabled: false },
        })
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.forceFeature',
            metadata: { feature: 'events', from: true, to: false },
        })
    })

    it('turns videos on only with the VIDEO module', async () => {
        const d = build({ ws: flags })
        d.modules.assertEntitled.mockRejectedValue(
            new ModuleNotEntitledError({ module: 'VIDEO', message: 'нет' }),
        )
        await expect(runFeature(d, { feature: 'videos', enabled: true })).rejects.toBeInstanceOf(
            ModuleNotEntitledError,
        )
        expect(d.prisma.workspace.update).not.toHaveBeenCalled()
        // Switching it off is always allowed.
        await runFeature(d, { feature: 'videos', enabled: false })
        expect(d.prisma.workspace.update).toHaveBeenCalled()
    })
})

describe('GetPlatformWorkspaceBillingHandler', () => {
    it('refuses anyone but a platform admin, otherwise loads the card', async () => {
        const d = build()
        const handler = new GetPlatformWorkspaceBillingHandler(
            d.prisma as never,
            d.billing as never,
            d.audit as never,
        )
        await expect(
            handler.execute(new GetPlatformWorkspaceBillingFeature('w1', 'u1', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            handler.execute(new GetPlatformWorkspaceBillingFeature('w1', 'u1', true)),
        ).resolves.toEqual({ card: true })
    })
})
