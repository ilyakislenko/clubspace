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
    reads = 0
    private payments = new Map<string, GatewayPayment>()
    private seq = 0

    reset() {
        this.created = []
        this.refunds = []
        this.reads = 0
        this.payments.clear()
        this.seq = 0
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
        p: { providerPaymentId: string; idempotenceKey: string },
    ) => {
        this.refunds.push({
            providerPaymentId: p.providerPaymentId,
            idempotenceKey: p.idempotenceKey,
        })
    }

    checkConnection = async () => ({ accountId: '123456', testMode: true })
}
