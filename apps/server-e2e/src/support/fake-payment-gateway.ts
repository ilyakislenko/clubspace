import type {
    CreateGatewayPaymentInput,
    GatewayCredentials,
    GatewayPayment,
    GatewayPaymentStatus,
    PaymentGatewayError,
} from '../../../server/src/domains/payments/payment-gateway.types'

// One queued answer to a saved-card charge (paymentMethodId): a status (with
// YooKassa's cancellation reason), or a provider error. `landed` = the
// provider created the payment even though the answer was lost (a timeout
// after the request reached it) — a retry with the same Idempotence-Key gets
// that payment back, as YooKassa answers.
export type FakeChargeAnswer =
    | { status: GatewayPaymentStatus; cancellationReason?: string }
    | { error: PaymentGatewayError; landed?: GatewayPaymentStatus }

// Stands in for YooKassa / Stripe at the PaymentGatewayClient boundary: keeps
// the payments it "created", answers re-reads with whatever status the spec
// sets, and records every call. Everything else — guards, handlers, the
// webhook signature check, the subscription grant / ticket mark, Postgres —
// is real. Pass it as `createTestApp({ paymentGateway })`.
//
// Saved cards (member autopay): a redirect checkout sent with
// savePaymentMethod true comes back with a saved payment method (unless
// `saveCards` is false — a shop that didn't save it); a charge of a saved card
// (paymentMethodId) is answered at once from `charges` (default: succeeded).
// A repeated Idempotence-Key returns the payment created under it.
export class FakeGateway {
    created: Array<{ creds: GatewayCredentials; input: CreateGatewayPaymentInput }> = []
    refunds: Array<{ providerPaymentId: string; idempotenceKey: string }> = []
    // Every refund call in full: amount and the 54-ФЗ receipt asked for.
    refundRequests: Array<{
        providerPaymentId: string
        idempotenceKey: string
        amount: number
        receipt?: { customerEmail: string; itemName: string }
    }> = []
    reads = 0
    saveCards = true
    charges: FakeChargeAnswer[] = []
    // Queued refusals of the next payer checkouts (e.g. a shop without autopay).
    checkoutErrors: PaymentGatewayError[] = []
    private payments = new Map<string, GatewayPayment>()
    private byKey = new Map<string, string>()
    private seq = 0
    // pauseRefunds(): the next refund call waits at the provider until the
    // spec releases it, so a second request can be made to meet the first one's
    // locks.
    private paused: { reached: () => void; gate: Promise<void> } | null = null

    reset() {
        this.created = []
        this.refunds = []
        this.refundRequests = []
        this.reads = 0
        this.saveCards = true
        this.charges = []
        this.checkoutErrors = []
        this.payments.clear()
        this.byKey.clear()
        this.seq = 0
        this.paused = null
    }

    pauseRefunds(): { reached: Promise<void>; release: () => void } {
        // Executor form: the e2e tsconfig's lib (es2022) has no
        // Promise.withResolvers.
        let reached: () => void = () => undefined
        let release: () => void = () => undefined
        const reachedP = new Promise<void>((r) => (reached = r))
        const gate = new Promise<void>((r) => (release = r))
        this.paused = { reached, gate }
        return { reached: reachedP, release }
    }

    setStatus(
        providerPaymentId: string,
        status: GatewayPaymentStatus,
        extra: Partial<GatewayPayment> = {},
    ) {
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        this.payments.set(providerPaymentId, { ...p, ...extra, status })
    }

    get(providerPaymentId: string): GatewayPayment | undefined {
        return this.payments.get(providerPaymentId)
    }

    createPayment = async (
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        this.created.push({ creds, input })
        const known = this.byKey.get(input.idempotenceKey)
        if (known) return this.payments.get(known) as GatewayPayment
        const id = `${creds.provider === 'STRIPE' ? 'cs' : 'yk'}_${++this.seq}`
        if (input.paymentMethodId) return this.charge(id, input)
        const refusal = this.checkoutErrors.shift()
        if (refusal) throw refusal
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: 'PENDING',
            confirmationUrl: `https://provider.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
            paymentMethod: {
                id: `pm_${id}`,
                saved: input.savePaymentMethod === true && this.saveCards,
                title: 'Bank card *4444',
                cardLast4: '4444',
            },
        }
        this.store(id, input.idempotenceKey, payment)
        return payment
    }

    getPayment = async (
        _creds: GatewayCredentials,
        providerPaymentId: string,
    ): Promise<GatewayPayment> => {
        this.reads++
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        return p
    }

    refund = async (
        _creds: GatewayCredentials,
        p: {
            providerPaymentId: string
            idempotenceKey: string
            amount: number
            receipt?: { customerEmail: string; itemName: string }
        },
    ) => {
        if (this.paused) {
            const paused = this.paused
            this.paused = null
            paused.reached()
            await paused.gate
        }
        this.refunds.push({
            providerPaymentId: p.providerPaymentId,
            idempotenceKey: p.idempotenceKey,
        })
        this.refundRequests.push({
            providerPaymentId: p.providerPaymentId,
            idempotenceKey: p.idempotenceKey,
            amount: p.amount,
            ...(p.receipt ? { receipt: p.receipt } : {}),
        })
    }

    checkConnection = async () => ({ accountId: '123456', testMode: true })

    // A saved card charged with no payer present: answered at once.
    private charge(id: string, input: CreateGatewayPaymentInput): GatewayPayment {
        const answer: FakeChargeAnswer = this.charges.shift() ?? { status: 'SUCCEEDED' }
        const payment = (status: GatewayPaymentStatus, reason?: string): GatewayPayment => ({
            providerPaymentId: id,
            status,
            confirmationUrl: null,
            amountMinor: input.amount * 100,
            currency: input.currency,
            paymentMethod: {
                id: input.paymentMethodId as string,
                saved: true,
                title: 'Bank card *4444',
                cardLast4: '4444',
            },
            cancellationReason: reason ?? null,
        })
        if ('error' in answer) {
            if (answer.landed) this.store(id, input.idempotenceKey, payment(answer.landed))
            throw answer.error
        }
        const created = payment(answer.status, answer.cancellationReason)
        this.store(id, input.idempotenceKey, created)
        return created
    }

    private store(id: string, idempotenceKey: string, payment: GatewayPayment) {
        this.payments.set(id, payment)
        this.byKey.set(idempotenceKey, id)
    }
}
