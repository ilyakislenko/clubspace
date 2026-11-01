import { z } from 'zod'

import {
    BillingAutopaySchema,
    PlatformModuleCodeSchema,
    PlatformPaymentListSchema,
    PlatformPaymentSchema,
} from './schemas'

// The club's own side of paying ClubSpace: the card checkout, its modules,
// the payment history, the saved card and the billing period. All
// workspace-admin only (owner or admin role), all open in a suspended club
// except the module switch — that page is how a suspended club gets paid.

const PeriodMonthsSchema = z
    .number()
    .int()
    .refine((v) => v === 1 || v === 12, 'Период оплаты — 1 или 12 месяцев')

class WorkspaceBillingCommand {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

// POST /workspaces/:workspaceId/billing/checkout
export const StartWorkspaceBillingCheckoutInputSchema = z.object({
    periodMonths: PeriodMonthsSchema,
})
export const StartWorkspaceBillingCheckoutOutputSchema = z.object({
    payment: PlatformPaymentSchema,
    // YooKassa's payment page; it returns to the «Тариф» page.
    confirmationUrl: z.string(),
})
export class StartWorkspaceBillingCheckoutFeature extends WorkspaceBillingCommand {
    constructor(
        readonly payload: z.infer<typeof StartWorkspaceBillingCheckoutInputSchema>,
        ...rest: ConstructorParameters<typeof WorkspaceBillingCommand>
    ) {
        super(...rest)
    }
}
export type StartWorkspaceBillingCheckoutFeatureResponse = z.infer<
    typeof StartWorkspaceBillingCheckoutOutputSchema
>

// POST /workspaces/:workspaceId/billing/card — «пробный период с картой»: bind
// a card during the trial (a small check on YooKassa's page, refunded at once);
// the first period is charged from it when the trial ends.
export const StartWorkspaceBillingCardCheckOutputSchema =
    StartWorkspaceBillingCheckoutOutputSchema
export class StartWorkspaceBillingCardCheckFeature extends WorkspaceBillingCommand {}
export type StartWorkspaceBillingCardCheckFeatureResponse = z.infer<
    typeof StartWorkspaceBillingCardCheckOutputSchema
>

// POST /workspaces/:workspaceId/billing/modules
export const SetWorkspaceBillingModuleInputSchema = z.object({
    module: PlatformModuleCodeSchema,
    // true = connect, false = disconnect at the end of the paid period.
    enabled: z.boolean(),
})
export const SetWorkspaceBillingModuleOutputSchema = z.object({
    // CONNECTED — on now; PAYMENT_REQUIRED — pay on confirmationUrl first;
    // PAYMENT_PENDING — the saved card is being charged; RESTORED — a
    // scheduled disconnection was cancelled; DISCONNECT_SCHEDULED — off at
    // the end of the paid period; DISCONNECTED — off now.
    outcome: z.enum([
        'CONNECTED',
        'PAYMENT_REQUIRED',
        'PAYMENT_PENDING',
        'RESTORED',
        'DISCONNECTED',
        'DISCONNECT_SCHEDULED',
    ]),
    payment: PlatformPaymentSchema.nullable(),
    confirmationUrl: z.string().nullable(),
})
export class SetWorkspaceBillingModuleFeature extends WorkspaceBillingCommand {
    constructor(
        readonly payload: z.infer<typeof SetWorkspaceBillingModuleInputSchema>,
        ...rest: ConstructorParameters<typeof WorkspaceBillingCommand>
    ) {
        super(...rest)
    }
}
export type SetWorkspaceBillingModuleFeatureResponse = z.infer<
    typeof SetWorkspaceBillingModuleOutputSchema
>

// GET /workspaces/:workspaceId/billing/payments
export const ListWorkspaceBillingPaymentsOutputSchema = PlatformPaymentListSchema
export class ListWorkspaceBillingPaymentsFeature extends WorkspaceBillingCommand {}
export type ListWorkspaceBillingPaymentsFeatureResponse = z.infer<
    typeof ListWorkspaceBillingPaymentsOutputSchema
>

// GET /workspaces/:workspaceId/billing/payments/:paymentId — re-reads a
// pending payment from YooKassa (the owner just came back from its page).
export const GetWorkspaceBillingPaymentOutputSchema = PlatformPaymentSchema
export class GetWorkspaceBillingPaymentFeature extends WorkspaceBillingCommand {
    constructor(
        readonly paymentId: string,
        ...rest: ConstructorParameters<typeof WorkspaceBillingCommand>
    ) {
        super(...rest)
    }
}
export type GetWorkspaceBillingPaymentFeatureResponse = z.infer<
    typeof GetWorkspaceBillingPaymentOutputSchema
>

// DELETE /workspaces/:workspaceId/billing/payment-method — autopay off.
export const RemoveWorkspaceBillingCardOutputSchema = BillingAutopaySchema
export class RemoveWorkspaceBillingCardFeature extends WorkspaceBillingCommand {}
export type RemoveWorkspaceBillingCardFeatureResponse = z.infer<
    typeof RemoveWorkspaceBillingCardOutputSchema
>

// PUT /workspaces/:workspaceId/billing/period — monthly or annual renewals.
export const SetWorkspaceBillingPeriodInputSchema = z.object({
    periodMonths: PeriodMonthsSchema,
})
export const SetWorkspaceBillingPeriodOutputSchema = z.object({
    billingPeriodMonths: z.number().int(),
})
export class SetWorkspaceBillingPeriodFeature extends WorkspaceBillingCommand {
    constructor(
        readonly payload: z.infer<typeof SetWorkspaceBillingPeriodInputSchema>,
        ...rest: ConstructorParameters<typeof WorkspaceBillingCommand>
    ) {
        super(...rest)
    }
}
export type SetWorkspaceBillingPeriodFeatureResponse = z.infer<
    typeof SetWorkspaceBillingPeriodOutputSchema
>
