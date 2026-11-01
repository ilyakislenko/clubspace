import { z } from 'zod'

import { environment } from '../../environments/environment'
import { displayName } from '../attendance/schemas'

export const PAYMENT_PROVIDERS = ['YOOKASSA', 'STRIPE'] as const
export const PAYMENT_STATUSES = [
    'PENDING',
    'SUCCEEDED',
    'CANCELED',
    'REFUNDED',
] as const
// YooKassa receipt values a club sells abonements with (54-ФЗ «признак
// предмета расчёта» / «признак способа расчёта»).
export const PAYMENT_SUBJECTS = ['service', 'another'] as const
export const PAYMENT_MODES = [
    'full_prepayment',
    'full_payment',
    'advance',
] as const

export const PaymentProviderSchema = z.enum(PAYMENT_PROVIDERS)
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES)

// What the member sees about their own purchase.
export const MyPaymentOutputSchema = z.object({
    id: z.string().uuid(),
    planId: z.string().uuid().nullable(),
    planName: z.string(),
    provider: PaymentProviderSchema,
    status: PaymentStatusSchema,
    amount: z.number().int(),
    currency: z.string(),
    // The abonement this payment created (null while pending, or when staff
    // must create it by hand — see activationError).
    subscriptionId: z.string().uuid().nullable(),
    // Paid, but the abonement was not created automatically.
    activationError: z.string().nullable(),
    createdAt: z.iso.datetime(),
    paidAt: z.iso.datetime().nullable(),
    refundedAt: z.iso.datetime().nullable(),
})
export type MyPaymentOutput = z.infer<typeof MyPaymentOutputSchema>

// The admin list row: the same plus the buyer.
export const PaymentOutputSchema = MyPaymentOutputSchema.extend({
    member: z.object({
        userId: z.string().uuid(),
        name: z.string(),
        email: z.string(),
    }),
})
export type PaymentOutput = z.infer<typeof PaymentOutputSchema>

type PaymentRow = {
    id: string
    planId: string | null
    planName: string
    provider: 'YOOKASSA' | 'STRIPE'
    status: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | 'REFUNDED'
    amount: number
    currency: string
    subscriptionId: string | null
    activationError: string | null
    createdAt: Date
    paidAt: Date | null
    refundedAt: Date | null
}

export const serializeMyPayment = (p: PaymentRow): MyPaymentOutput => ({
    id: p.id,
    planId: p.planId,
    planName: p.planName,
    provider: p.provider,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    subscriptionId: p.subscriptionId,
    activationError: p.activationError,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    refundedAt: p.refundedAt ? p.refundedAt.toISOString() : null,
})

export const serializePayment = (
    p: PaymentRow & {
        userId: string
        user: { firstname: string | null; lastname: string | null; email: string }
    },
): PaymentOutput => ({
    ...serializeMyPayment(p),
    member: { userId: p.userId, name: displayName(p.user), email: p.user.email },
})

export const PaymentSettingsOutputSchema = z.object({
    // A provider is connected (credentials saved). Secrets are never returned.
    connected: z.boolean(),
    provider: PaymentProviderSchema.nullable(),
    shopId: z.string().nullable(),
    // "••••1234" — the last characters of the saved secret key.
    secretKeyMasked: z.string().nullable(),
    // Stripe: a webhook signing secret is saved.
    webhookSecretSet: z.boolean(),
    receiptEnabled: z.boolean(),
    vatCode: z.number().int(),
    paymentSubject: z.enum(PAYMENT_SUBJECTS),
    paymentMode: z.enum(PAYMENT_MODES),
    // Last successful «Проверить подключение».
    verifiedAt: z.iso.datetime().nullable(),
    // Addresses to paste into the provider's dashboard (HTTP notifications /
    // webhook endpoint) — one per provider, for this club.
    webhookUrls: z.object({ yookassa: z.string(), stripe: z.string() }),
    // Active tariffs flagged «можно купить онлайн».
    onlinePlanCount: z.number().int(),
})
export type PaymentSettingsOutput = z.infer<typeof PaymentSettingsOutputSchema>

export const paymentWebhookUrls = (workspaceId: string) => {
    const api = environment.rootUrl.replace(/\/+$/, '')
    return {
        yookassa: `${api}/payments/webhooks/yookassa/${workspaceId}`,
        stripe: `${api}/payments/webhooks/stripe/${workspaceId}`,
    }
}

export const DEFAULT_RECEIPT = {
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service' as const,
    paymentMode: 'full_prepayment' as const,
}

const asSubject = (v: string) =>
    (PAYMENT_SUBJECTS as readonly string[]).includes(v)
        ? (v as (typeof PAYMENT_SUBJECTS)[number])
        : DEFAULT_RECEIPT.paymentSubject
const asMode = (v: string) =>
    (PAYMENT_MODES as readonly string[]).includes(v)
        ? (v as (typeof PAYMENT_MODES)[number])
        : DEFAULT_RECEIPT.paymentMode

export const serializePaymentSettings = (
    workspaceId: string,
    row: {
        provider: 'YOOKASSA' | 'STRIPE'
        shopId: string | null
        secretKeyHint: string
        webhookSecretEncrypted: string | null
        receiptEnabled: boolean
        vatCode: number
        paymentSubject: string
        paymentMode: string
        verifiedAt: Date | null
    } | null,
    onlinePlanCount: number,
): PaymentSettingsOutput => ({
    connected: !!row,
    provider: row?.provider ?? null,
    shopId: row?.shopId ?? null,
    secretKeyMasked: row ? `••••${row.secretKeyHint}` : null,
    webhookSecretSet: !!row?.webhookSecretEncrypted,
    receiptEnabled: row?.receiptEnabled ?? DEFAULT_RECEIPT.receiptEnabled,
    vatCode: row?.vatCode ?? DEFAULT_RECEIPT.vatCode,
    paymentSubject: row
        ? asSubject(row.paymentSubject)
        : DEFAULT_RECEIPT.paymentSubject,
    paymentMode: row ? asMode(row.paymentMode) : DEFAULT_RECEIPT.paymentMode,
    verifiedAt: row?.verifiedAt ? row.verifiedAt.toISOString() : null,
    webhookUrls: paymentWebhookUrls(workspaceId),
    onlinePlanCount,
})
