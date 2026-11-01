import { z } from 'zod'

import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// One console action per call, every one audited. Payment itself is collected
// outside ClubSpace; `markPaid` only records that a period was paid.
export const PLATFORM_BILLING_ACTIONS = [
    'extendTrial',
    'markPaid',
    'extendPeriod',
    'suspend',
    'resume',
    'setNotes',
    'setCustomPrice',
    'setDiscount',
    'setFreeUntil',
    'setSetupFeeWaived',
    'setBillingPeriod',
] as const

// Flat object + superRefine rather than a discriminated union, so the
// contract stays free of oneOf.
export const UpdatePlatformWorkspaceBillingInputSchema = z
    .object({
        kind: z.enum(PLATFORM_BILLING_ACTIONS),
        // extendTrial / markPaid / extendPeriod: days added to the later of
        // now and the current end, so an early renewal never loses paid days.
        days: z.number().int().min(1).max(366).optional(),
        // setNotes; an empty string clears them.
        notes: z.string().trim().max(2000).optional(),
        // setCustomPrice: whole rubles per month instead of the tier price;
        // null goes back to the tier price.
        customMonthlyPrice: z.number().int().min(0).max(10_000_000).nullable().optional(),
        // setDiscount: off the recurring lines, 0 = none; through
        // discountUntil (inclusive, Moscow) when given, else with no end.
        discountPercent: z.number().int().min(0).max(100).optional(),
        discountUntil: z.iso.date().nullable().optional(),
        // setFreeUntil: the subscription is free through this date
        // (inclusive, Moscow); null ends the promo.
        freeUntil: z.iso.date().nullable().optional(),
        // setSetupFeeWaived
        setupFeeWaived: z.boolean().optional(),
        // setBillingPeriod: 1 = monthly, 12 = annual prepay.
        billingPeriodMonths: z
            .number()
            .int()
            .refine((v) => v === 1 || v === 12, 'Период оплаты — 1 или 12 месяцев')
            .optional(),
    })
    .superRefine((v, ctx) => {
        const need = (field: keyof typeof v, message: string) =>
            ctx.addIssue({ code: 'custom', path: [field], message })
        if (
            (v.kind === 'extendTrial' ||
                v.kind === 'markPaid' ||
                v.kind === 'extendPeriod') &&
            !v.days
        ) {
            need('days', 'Укажите число дней')
        }
        if (v.kind === 'setNotes' && v.notes === undefined) {
            need('notes', 'Пустая заметка')
        }
        if (v.kind === 'setCustomPrice' && v.customMonthlyPrice === undefined) {
            need('customMonthlyPrice', 'Укажите цену или сбросьте её')
        }
        if (v.kind === 'setDiscount' && v.discountPercent === undefined) {
            need('discountPercent', 'Укажите скидку в процентах')
        }
        if (v.kind === 'setFreeUntil' && v.freeUntil === undefined) {
            need('freeUntil', 'Укажите дату или сбросьте её')
        }
        if (v.kind === 'setSetupFeeWaived' && v.setupFeeWaived === undefined) {
            need('setupFeeWaived', 'Укажите, списывать ли подключение')
        }
        if (v.kind === 'setBillingPeriod' && v.billingPeriodMonths === undefined) {
            need('billingPeriodMonths', 'Выберите период оплаты')
        }
    })

export const UpdatePlatformWorkspaceBillingOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class UpdatePlatformWorkspaceBillingFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: z.infer<typeof UpdatePlatformWorkspaceBillingInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdatePlatformWorkspaceBillingFeatureResponse = z.infer<
    typeof UpdatePlatformWorkspaceBillingOutputSchema
>
