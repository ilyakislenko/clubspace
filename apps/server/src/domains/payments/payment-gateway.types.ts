// Shapes shared by the provider adapters (yookassa-api.ts, stripe-api.ts), the
// HTTP client and the handlers. Amounts are whole currency units everywhere
// in ClubSpace (Plan.price, Payment.amount); the adapters convert to the
// provider's format at the edge.

export type PaymentProviderName = 'YOOKASSA' | 'STRIPE'

// 54-ФЗ receipt data the club configured (YooKassa only).
export type ReceiptSettings = {
    enabled: boolean
    // YooKassa vat_code: 1 без НДС … 11 22%, 12 22/122.
    vatCode: number
    paymentSubject: string
    paymentMode: string
    // YooKassa tax_system_code (1–6), when the shop has more than one tax
    // system; omitted otherwise.
    taxSystemCode?: number | null
}

export type GatewayCredentials =
    | {
          provider: 'YOOKASSA'
          shopId: string
          secretKey: string
          receipt: ReceiptSettings
      }
    | {
          provider: 'STRIPE'
          secretKey: string
      }

export type CreateGatewayPaymentInput = {
    // Our Payment.id, echoed back in the provider's metadata.
    paymentId: string
    workspaceId: string
    idempotenceKey: string
    amount: number
    currency: string
    // Shown on the provider's page and in the merchant dashboard.
    description: string
    // The receipt / line item name (the tariff).
    itemName: string
    returnUrl: string
    customerEmail: string
    // Ask the provider to keep the card for later charges without the payer
    // (YooKassa save_payment_method). The platform's own billing only.
    savePaymentMethod?: boolean
    // Charge a saved card instead of sending the payer to the provider's page
    // (YooKassa payment_method_id; no confirmation step).
    paymentMethodId?: string
}

export type GatewayPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELED'

// The provider's view of a payment, normalised.
export type GatewayPayment = {
    providerPaymentId: string
    status: GatewayPaymentStatus
    confirmationUrl: string | null
    // Minor units (kopecks, cents) as the provider reports them, so a
    // comparison with what we asked for never goes through floats.
    amountMinor: number | null
    currency: string | null
    // The card the payment went through; `saved` = the provider keeps it for
    // later charges (YooKassa only; absent elsewhere).
    paymentMethod?: GatewayPaymentMethod | null
    // Why a CANCELED payment was refused (YooKassa cancellation_details.reason,
    // e.g. insufficient_funds, permission_revoked).
    cancellationReason?: string | null
}

export type GatewayPaymentMethod = {
    id: string
    saved: boolean
    // «Bank card *4444» as the provider titles it.
    title: string | null
    cardLast4: string | null
}

export type GatewayConnectionInfo = {
    // Shop / account id the credentials belong to.
    accountId: string | null
    testMode: boolean
}

// A provider refused the request or could not be reached. `status` is the
// HTTP status (null for a network error or timeout); `providerMessage` is the
// provider's own explanation, for logs and the admin's connection check.
export class PaymentGatewayError extends Error {
    constructor(
        message: string,
        readonly status: number | null,
        readonly providerMessage: string | null = null,
    ) {
        super(message)
        this.name = 'PaymentGatewayError'
    }
}

// Currencies Stripe counts in whole units (no minor unit). YooKassa always
// uses two decimals.
const ZERO_DECIMAL: Record<string, true> = {
    BIF: true, CLP: true, DJF: true, GNF: true, JPY: true, KMF: true,
    KRW: true, MGA: true, PYG: true, RWF: true, UGX: true, VND: true,
    VUV: true, XAF: true, XOF: true, XPF: true,
}

export const toMinorUnits = (amount: number, currency: string): number =>
    ZERO_DECIMAL[currency.toUpperCase()] ? amount : amount * 100

// One HTTP call to a provider, fully built (URL, auth, idempotency header,
// encoded body) by the pure adapters so specs can assert on it directly.
export type ProviderRequest = {
    method: 'GET' | 'POST'
    url: string
    headers: Record<string, string>
    body?: string
}
