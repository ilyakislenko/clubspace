import type {
    CreateGatewayPaymentInput,
    GatewayCredentials,
    GatewayPayment,
    GatewayPaymentStatus,
} from '../../../server/src/domains/payments/payment-gateway.types'

// Stands in for YooKassa / Stripe at the PaymentGatewayClient boundary: keeps
// the payments it "created", answers re-reads with whatever status the spec
// sets, and records every call. Everything else — guards, handlers, the
// webhook signature check, the subscription grant / ticket mark, Postgres —
// is real. Pass it as `createTestApp({ paymentGateway })`.
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
    private payments = new Map<string, GatewayPayment>()
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
        this.payments.clear()
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

    setStatus(providerPaymentId: string, status: GatewayPaymentStatus) {
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        this.payments.set(providerPaymentId, { ...p, status })
    }

    createPayment = async (
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        this.created.push({ creds, input })
        const id = `${creds.provider === 'STRIPE' ? 'cs' : 'yk'}_${++this.seq}`
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: 'PENDING',
            confirmationUrl: `https://provider.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
        }
        this.payments.set(id, payment)
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
}
