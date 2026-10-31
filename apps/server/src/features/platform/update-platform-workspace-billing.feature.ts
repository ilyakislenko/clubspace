import { z } from 'zod'

import { WorkspaceBillingSummarySchema } from '../workspace-billing/schemas'

// One console action per call. Payment itself is collected outside ClubSpace;
// `markPaid` only records that a period was paid.
export const PLATFORM_BILLING_ACTIONS = [
    'changePlan',
    'extendTrial',
    'markPaid',
    'suspend',
    'resume',
    'setNotes',
] as const

// Flat object + superRefine rather than a discriminated union, so the
// contract stays free of oneOf.
export const UpdatePlatformWorkspaceBillingInputSchema = z
    .object({
        kind: z.enum(PLATFORM_BILLING_ACTIONS),
        // changePlan
        planId: z.string().uuid().optional(),
        // extendTrial / markPaid: days added to the later of now and the
        // current end, so an early renewal never loses paid days.
        days: z.number().int().min(1).max(366).optional(),
        // setNotes; an empty string clears them.
        notes: z.string().trim().max(2000).optional(),
    })
    .superRefine((v, ctx) => {
        if (v.kind === 'changePlan' && !v.planId) {
            ctx.addIssue({
                code: 'custom',
                path: ['planId'],
                message: 'Выберите тариф',
            })
        }
        if ((v.kind === 'extendTrial' || v.kind === 'markPaid') && !v.days) {
            ctx.addIssue({
                code: 'custom',
                path: ['days'],
                message: 'Укажите число дней',
            })
        }
        if (v.kind === 'setNotes' && v.notes === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['notes'],
                message: 'Пустая заметка',
            })
        }
    })

export const UpdatePlatformWorkspaceBillingOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    billing: WorkspaceBillingSummarySchema,
    notes: z.string().nullable(),
})

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
