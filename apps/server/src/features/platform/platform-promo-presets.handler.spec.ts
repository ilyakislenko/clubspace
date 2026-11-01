jest.mock('./platform-workspace-billing-view', () => ({
    loadPlatformWorkspaceBilling: jest.fn().mockResolvedValue({ card: true }),
}))

import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ApplyPlatformWorkspacePromoHandler } from './apply-platform-workspace-promo.handler'
import {
    ApplyPlatformWorkspacePromoFeature,
    PlatformWorkspacePromoInputSchema,
    PreviewPlatformWorkspacePromoFeature,
} from './platform-promo-presets.feature'
import { PreviewPlatformWorkspacePromoHandler } from './preview-platform-workspace-promo.handler'

const PERIOD_END = new Date('2099-12-01T00:00:00.000Z')

const CURRENT = {
    workspaceId: 'w1',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: PERIOD_END,
    pastDueSince: null,
    billingPeriodMonths: 1,
    customMonthlyPrice: null,
    discountPercent: 0,
    discountUntil: null,
    freeUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: null,
    paidTierCode: null,
    notes: null,
}

const quote = (total: number) => ({ lines: [], discounts: [], total })

const build = (o: { ws?: unknown; video?: unknown } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue('ws' in o ? o.ws : { id: 'w1' }),
        },
        workspaceBilling: {
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                ...CURRENT,
                ...data,
            })),
        },
        workspaceModuleEntitlement: {
            findFirst: jest.fn().mockResolvedValue(o.video ?? null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const billing = {
        getBilling: jest.fn().mockResolvedValue(CURRENT),
        previewNextCharge: jest.fn(
            async (_id: string, patch: { row?: Record<string, unknown> }) =>
                patch.row && Object.keys(patch.row).length > 0
                    ? { nextChargeAt: patch.row.currentPeriodEnd ?? PERIOD_END, quote: quote(1000) }
                    : { nextChargeAt: PERIOD_END, quote: quote(2990) },
        ),
    }
    return { prisma, audit, billing }
}

type Deps = ReturnType<typeof build>

const apply = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new ApplyPlatformWorkspacePromoHandler(
        d.prisma as never,
        d.audit as never,
        d.billing as never,
    ).execute(new ApplyPlatformWorkspacePromoFeature('w1', payload as never, 'staff-1', isSuperAdmin))

const preview = (d: Deps, payload: Record<string, unknown>, isSuperAdmin = true) =>
    new PreviewPlatformWorkspacePromoHandler(d.prisma as never, d.billing as never).execute(
        new PreviewPlatformWorkspacePromoFeature('w1', payload as never, 'staff-1', isSuperAdmin),
    )

describe('PlatformWorkspacePromoInputSchema', () => {
    it.each([
        [{ preset: 'FREE_MONTHS' }, false],
        [{ preset: 'FREE_MONTHS', months: 1 }, true],
        [{ preset: 'VIDEO_GIFT', months: 25 }, false],
        [{ preset: 'DISCOUNT', months: 3 }, false],
        [{ preset: 'DISCOUNT', months: 3, discountPercent: 30 }, true],
        [{ preset: 'NO_SETUP_FEE' }, true],
        [{ preset: 'FREE_FOREVER' }, false],
    ])('%j valid: %s', (input, ok) => {
        expect(PlatformWorkspacePromoInputSchema.safeParse(input).success).toBe(ok)
    })
})

describe('PreviewPlatformWorkspacePromoHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const d = build()
        await expect(
            preview(d, { preset: 'NO_SETUP_FEE' }, false),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.billing.previewNextCharge).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(preview(d, { preset: 'NO_SETUP_FEE' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('quotes the next charge before and after, writing nothing', async () => {
        const d = build()
        const out = await preview(d, { preset: 'DISCOUNT', months: 2, discountPercent: 50 })
        expect(d.billing.previewNextCharge.mock.calls[1][1]).toEqual({
            row: {
                discountPercent: 50,
                discountUntil: new Date('2100-02-01T00:00:00.000Z'),
            },
            modules: [],
        })
        expect(out).toEqual({
            summary: 'Скидка 50% на 2 мес. — до 01.02.2100',
            current: { nextChargeAt: PERIOD_END.toISOString(), quote: quote(2990) },
            next: { nextChargeAt: PERIOD_END.toISOString(), quote: quote(1000) },
        })
        expect(d.prisma.workspaceBilling.update).not.toHaveBeenCalled()
    })

    it('previews a video gift with the VIDEO row replaced', async () => {
        const d = build()
        await preview(d, { preset: 'VIDEO_GIFT', months: 1 })
        expect(d.billing.previewNextCharge.mock.calls[1][1].modules).toEqual([
            expect.objectContaining({ module: 'VIDEO', mode: 'COMP' }),
        ])
    })
})

describe('ApplyPlatformWorkspacePromoHandler', () => {
    it('refuses anyone but a platform admin', async () => {
        const d = build()
        await expect(
            apply(d, { preset: 'FREE_MONTHS', months: 1 }, false),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.prisma.workspaceBilling.update).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const d = build({ ws: null })
        await expect(apply(d, { preset: 'NO_SETUP_FEE' })).rejects.toBeInstanceOf(NotFoundError)
        expect(d.prisma.workspaceBilling.update).not.toHaveBeenCalled()
    })

    it('a free month moves the next charge a month on, audited from → to', async () => {
        const d = build()
        const out = await apply(d, { preset: 'FREE_MONTHS', months: 1 })
        const freeUntil = new Date('2100-01-01T00:00:00.000Z')
        expect(d.prisma.workspaceBilling.update).toHaveBeenCalledWith({
            where: { workspaceId: 'w1' },
            data: { freeUntil, currentPeriodEnd: freeUntil },
        })
        expect(d.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.promoApply',
            workspaceId: 'w1',
            actorId: 'staff-1',
            metadata: {
                preset: 'FREE_MONTHS',
                months: 1,
                summary: '1 мес. бесплатно — до 01.01.2100',
                from: { freeUntil: null, currentPeriodEnd: PERIOD_END },
                to: { freeUntil, currentPeriodEnd: freeUntil },
            },
        })
        expect(out).toEqual({ card: true })
    })

    it('a video gift writes the module only, audited with the previous setting', async () => {
        const d = build({ video: { module: 'VIDEO', mode: 'PAID', compUntil: null } })
        await apply(d, { preset: 'VIDEO_GIFT', months: 2 })
        expect(d.prisma.workspaceBilling.update).not.toHaveBeenCalled()
        expect(d.prisma.workspaceModuleEntitlement.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                workspaceId: 'w1',
                module: 'VIDEO',
                mode: 'COMP',
                customPrice: null,
                cancelAt: null,
            }),
        })
        expect(d.audit.record.mock.calls[0][0].metadata.module).toMatchObject({
            code: 'VIDEO',
            from: { mode: 'PAID', compUntil: null },
            to: { mode: 'COMP' },
        })
    })

    it('waives the setup fee', async () => {
        const d = build()
        await apply(d, { preset: 'NO_SETUP_FEE' })
        expect(d.prisma.workspaceBilling.update).toHaveBeenCalledWith({
            where: { workspaceId: 'w1' },
            data: { setupFeeWaived: true },
        })
        expect(d.audit.record.mock.calls[0][0].metadata).toMatchObject({
            from: { setupFeeWaived: false },
            to: { setupFeeWaived: true },
        })
    })
})
