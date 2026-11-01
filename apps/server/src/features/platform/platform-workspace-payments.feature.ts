import { z } from 'zod'

import {
    PlatformPaymentListSchema,
    PlatformPaymentSchema,
} from '../workspace-billing/schemas'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// The console's side of a club's card payments: the list, «повторить
// списание сейчас», a refund (full or partial) and the autopay switch. Super
// admin only, every write audited.

class PlatformWorkspaceCommand {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

// GET /platform/workspaces/:workspaceId/payments
export const ListPlatformWorkspacePaymentsOutputSchema = PlatformPaymentListSchema
export class ListPlatformWorkspacePaymentsFeature extends PlatformWorkspaceCommand {}
export type ListPlatformWorkspacePaymentsFeatureResponse = z.infer<
    typeof ListPlatformWorkspacePaymentsOutputSchema
>

// POST /platform/workspaces/:workspaceId/payments/retry
export const RetryPlatformWorkspacePaymentOutputSchema = z.object({
    outcome: z.enum(['CHARGED', 'EXTENDED_FREE', 'PENDING', 'FAILED', 'SKIPPED']),
    // Why nothing was charged, or why the card was refused.
    reason: z.string().nullable(),
    payment: PlatformPaymentSchema.nullable(),
})
export class RetryPlatformWorkspacePaymentFeature extends PlatformWorkspaceCommand {}
export type RetryPlatformWorkspacePaymentFeatureResponse = z.infer<
    typeof RetryPlatformWorkspacePaymentOutputSchema
>

// POST /platform/workspaces/:workspaceId/payments/:paymentId/refund
export const RefundPlatformWorkspacePaymentInputSchema = z.object({
    // Whole rubles; omitted = everything not yet refunded.
    amount: z.number().int().min(1).max(10_000_000).optional(),
    reason: z.string().trim().max(500).optional(),
})
export const RefundPlatformWorkspacePaymentOutputSchema = PlatformPaymentSchema
export class RefundPlatformWorkspacePaymentFeature extends PlatformWorkspaceCommand {
    constructor(
        readonly paymentId: string,
        readonly payload: z.infer<typeof RefundPlatformWorkspacePaymentInputSchema>,
        ...rest: ConstructorParameters<typeof PlatformWorkspaceCommand>
    ) {
        super(...rest)
    }
}
export type RefundPlatformWorkspacePaymentFeatureResponse = z.infer<
    typeof RefundPlatformWorkspacePaymentOutputSchema
>

// POST /platform/workspaces/:workspaceId/autopay
export const SetPlatformWorkspaceAutopayInputSchema = z.object({
    enabled: z.boolean(),
})
export const SetPlatformWorkspaceAutopayOutputSchema =
    PlatformWorkspaceBillingOutputSchema
export class SetPlatformWorkspaceAutopayFeature extends PlatformWorkspaceCommand {
    constructor(
        readonly payload: z.infer<typeof SetPlatformWorkspaceAutopayInputSchema>,
        ...rest: ConstructorParameters<typeof PlatformWorkspaceCommand>
    ) {
        super(...rest)
    }
}
export type SetPlatformWorkspaceAutopayFeatureResponse = z.infer<
    typeof SetPlatformWorkspaceAutopayOutputSchema
>
