import { z } from 'zod'

import type {
    CreateGatewayPaymentInput,
    GatewayConnectionInfo,
    GatewayPayment,
    GatewayPaymentStatus,
    ProviderRequest,
    ReceiptSettings,
} from './payment-gateway.types'

// YooKassa API v3: https://yookassa.ru/developers/api
// Basic auth with shopId:secretKey; every POST carries an Idempotence-Key so a
// retried request (timeout, double tap) never creates a second payment.

export const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3'

// YooKassa limits description and receipt item text to 128 characters.
const MAX_TEXT = 128

type YookassaCredentials = { shopId: string; secretKey: string }

const clip = (text: string) =>
    text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text

const authHeader = (c: YookassaCredentials) =>
    `Basic ${Buffer.from(`${c.shopId}:${c.secretKey}`).toString('base64')}`

// Whole units → "4500.00".
export const formatYookassaAmount = (amount: number) => amount.toFixed(2)

const jsonPost = (
    c: YookassaCredentials,
    path: string,
    idempotenceKey: string,
    body: unknown,
): ProviderRequest => ({
    method: 'POST',
    url: `${YOOKASSA_API_URL}${path}`,
    headers: {
        Authorization: authHeader(c),
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
    },
    body: JSON.stringify(body),
})

const get = (c: YookassaCredentials, path: string): ProviderRequest => ({
    method: 'GET',
    url: `${YOOKASSA_API_URL}${path}`,
    headers: { Authorization: authHeader(c) },
})

// The 54-ФЗ receipt: the member's e-mail and one line, the tariff.
export const buildYookassaReceipt = (
    input: Pick<
        CreateGatewayPaymentInput,
        'customerEmail' | 'itemName' | 'amount' | 'currency'
    >,
    receipt: ReceiptSettings,
) => ({
    customer: { email: input.customerEmail },
    items: [
        {
            description: clip(input.itemName),
            quantity: '1.00',
            amount: {
                value: formatYookassaAmount(input.amount),
                currency: input.currency,
            },
            vat_code: receipt.vatCode,
            payment_subject: receipt.paymentSubject,
            payment_mode: receipt.paymentMode,
        },
    ],
})

export const buildYookassaCreatePayment = (
    c: YookassaCredentials & { receipt: ReceiptSettings },
    input: CreateGatewayPaymentInput,
): ProviderRequest =>
    jsonPost(c, '/payments', input.idempotenceKey, {
        amount: {
            value: formatYookassaAmount(input.amount),
            currency: input.currency,
        },
        // One-stage payment: money is captured on confirmation, nothing waits
        // for a manual capture.
        capture: true,
        confirmation: { type: 'redirect', return_url: input.returnUrl },
        description: clip(input.description),
        metadata: {
            paymentId: input.paymentId,
            workspaceId: input.workspaceId,
        },
        ...(c.receipt.enabled
            ? { receipt: buildYookassaReceipt(input, c.receipt) }
            : {}),
    })

export const buildYookassaGetPayment = (
    c: YookassaCredentials,
    providerPaymentId: string,
): ProviderRequest =>
    get(c, `/payments/${encodeURIComponent(providerPaymentId)}`)

export const buildYookassaRefund = (
    c: YookassaCredentials,
    p: {
        providerPaymentId: string
        amount: number
        currency: string
        idempotenceKey: string
    },
): ProviderRequest =>
    jsonPost(c, '/refunds', p.idempotenceKey, {
        payment_id: p.providerPaymentId,
        amount: { value: formatYookassaAmount(p.amount), currency: p.currency },
    })

// «Информация о магазине» — the cheapest authenticated read.
export const buildYookassaMe = (c: YookassaCredentials): ProviderRequest =>
    get(c, '/me')

const STATUS: Record<string, GatewayPaymentStatus> = {
    pending: 'PENDING',
    // capture: true never parks here, but a payment created by hand in the
    // dashboard might; it is not money yet.
    waiting_for_capture: 'PENDING',
    succeeded: 'SUCCEEDED',
    canceled: 'CANCELED',
}

// Only the fields we act on; YooKassa adds fields freely.
const YookassaPaymentSchema = z.object({
    id: z.string().min(1),
    status: z.string(),
    paid: z.boolean().optional(),
    amount: z.object({ value: z.string(), currency: z.string() }).optional(),
    confirmation: z
        .object({ confirmation_url: z.string().optional() })
        .optional(),
})

const YookassaMeSchema = z.object({
    account_id: z.union([z.string(), z.number()]).optional(),
    test: z.boolean().optional(),
})

const YookassaErrorSchema = z.object({ description: z.string() })

export const parseYookassaPayment = (json: unknown): GatewayPayment => {
    const payment = YookassaPaymentSchema.parse(json)
    const status = STATUS[payment.status] ?? 'PENDING'
    const value = payment.amount
        ? Number.parseFloat(payment.amount.value)
        : Number.NaN
    return {
        providerPaymentId: payment.id,
        // A succeeded payment must also say it is paid; anything else is not
        // money we can grant an abonement for.
        status:
            status === 'SUCCEEDED' && payment.paid !== true ? 'PENDING' : status,
        confirmationUrl: payment.confirmation?.confirmation_url ?? null,
        amountMinor: Number.isFinite(value) ? Math.round(value * 100) : null,
        currency: payment.amount?.currency ?? null,
    }
}

export const parseYookassaMe = (json: unknown): GatewayConnectionInfo => {
    const me = YookassaMeSchema.parse(json)
    return {
        accountId: me.account_id != null ? String(me.account_id) : null,
        testMode: me.test === true,
    }
}

// YooKassa error body: { type: 'error', code, description, parameter }.
export const yookassaErrorMessage = (json: unknown): string | null =>
    YookassaErrorSchema.safeParse(json).data?.description ?? null
