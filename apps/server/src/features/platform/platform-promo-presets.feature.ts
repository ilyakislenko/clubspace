import { z } from 'zod'

import { WorkspaceQuoteSchema } from '../workspace-billing/schemas'
import { PROMO_PRESETS } from './platform-billing-utils'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// One-click promos of the platform console card. Each applies existing
// overrides (platform-billing-utils.promoPresetPlan): FREE_MONTHS («1/2/3
// месяца бесплатно») → freeUntil, VIDEO_GIFT → VIDEO COMP until a date,
// DISCOUNT → discountPercent + discountUntil, NO_SETUP_FEE → setupFeeWaived.
// Flat object + superRefine (no oneOf in the contract).
export const PlatformWorkspacePromoInputSchema = z
    .object({
        preset: z.enum(PROMO_PRESETS),
        // FREE_MONTHS / VIDEO_GIFT / DISCOUNT: how long.
        months: z.number().int().min(1).max(24).optional(),
        // DISCOUNT only.
        discountPercent: z.number().int().min(1).max(100).optional(),
    })
    .superRefine((v, ctx) => {
        if (v.preset !== 'NO_SETUP_FEE' && v.months === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['months'],
                message: 'Укажите число месяцев',
            })
        }
        if (v.preset === 'DISCOUNT' && v.discountPercent === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['discountPercent'],
                message: 'Укажите скидку в процентах',
            })
        }
    })

export type PlatformWorkspacePromoInput = z.infer<
    typeof PlatformWorkspacePromoInputSchema
>

const NextChargeSchema = z.object({
    nextChargeAt: z.iso.datetime().nullable(),
    quote: WorkspaceQuoteSchema,
})

// What confirming the preset would do: the next charge now and after.
export const PreviewPlatformWorkspacePromoOutputSchema = z.object({
    summary: z.string(),
    current: NextChargeSchema,
    next: NextChargeSchema,
})

export class PreviewPlatformWorkspacePromoFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: PlatformWorkspacePromoInput,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type PreviewPlatformWorkspacePromoFeatureResponse = z.infer<
    typeof PreviewPlatformWorkspacePromoOutputSchema
>

export const ApplyPlatformWorkspacePromoOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class ApplyPlatformWorkspacePromoFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: PlatformWorkspacePromoInput,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ApplyPlatformWorkspacePromoFeatureResponse = z.infer<
    typeof ApplyPlatformWorkspacePromoOutputSchema
>
