jest.mock('../../domains/billing/platform-payment-credentials', () => ({
    platformGatewayCredentials: jest.fn(),
}))

import { platformGatewayCredentials } from '../../domains/billing/platform-payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import {
    BadRequestError,
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import { HandlePlatformYookassaWebhookFeature } from './handle-payment-webhook.feature'
import { HandlePlatformYookassaWebhookHandler } from './handle-platform-yookassa-webhook.handler'

const credsMock = platformGatewayCredentials as jest.Mock
const CREDS = { provider: 'YOOKASSA', shopId: '1', secretKey: 'k', receipt: {} }
const BODY = { event: 'payment.succeeded', object: { id: 'yk-1' } }

const build = (o: { known?: boolean; gateway?: unknown; gatewayError?: Error } = {}) => {
    const prisma = {
        platformPayment: {
            findUnique: jest.fn().mockResolvedValue(o.known === false ? null : { id: 'p1' }),
        },
    }
    const gateway = {
        getPayment: o.gatewayError
            ? jest.fn().mockRejectedValue(o.gatewayError)
            : jest.fn().mockResolvedValue(o.gateway ?? { providerPaymentId: 'yk-1', status: 'SUCCEEDED' }),
    }
    const payments = { applyGateway: jest.fn().mockResolvedValue(undefined) }
    const handler = new HandlePlatformYookassaWebhookHandler(
        prisma as never,
        gateway as never,
        payments as never,
    )
    return { handler, prisma, gateway, payments }
}

const run = (h: HandlePlatformYookassaWebhookHandler, body: unknown = BODY) =>
    h.execute(new HandlePlatformYookassaWebhookFeature(body))

describe('HandlePlatformYookassaWebhookHandler', () => {
    beforeEach(() => credsMock.mockReset().mockReturnValue(CREDS))

    it('rejects a malformed body', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, { object: {} })).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.platformPayment.findUnique).not.toHaveBeenCalled()
    })

    it('404s when the platform shop is not configured', async () => {
        credsMock.mockReturnValue(null)
        const { handler, prisma } = build()
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.platformPayment.findUnique).not.toHaveBeenCalled()
    })

    it('acknowledges an unknown payment without calling YooKassa', async () => {
        const { handler, prisma, gateway } = build({ known: false })
        await expect(run(handler)).resolves.toEqual({ received: true })
        expect(prisma.platformPayment.findUnique).toHaveBeenCalledWith({
            where: { providerPaymentId: 'yk-1' },
            select: { id: true },
        })
        expect(gateway.getPayment).not.toHaveBeenCalled()
    })

    it('5xxs when YooKassa cannot be read so the notification is redelivered', async () => {
        const { handler, payments } = build({
            gatewayError: new PaymentGatewayError('timeout', null),
        })
        await expect(run(handler)).rejects.toBeInstanceOf(UnexpectedError)
        expect(payments.applyGateway).not.toHaveBeenCalled()
    })

    it('rethrows a non-gateway error as is', async () => {
        const { handler } = build({ gatewayError: new Error('boom') })
        await expect(run(handler)).rejects.toThrow('boom')
    })

    it('does not apply an answer for another payment id', async () => {
        const { handler, payments } = build({ gateway: { providerPaymentId: 'yk-other' } })
        await expect(run(handler)).resolves.toEqual({ received: true })
        expect(payments.applyGateway).not.toHaveBeenCalled()
    })

    it('applies the payment re-read with the platform credentials', async () => {
        const answer = { providerPaymentId: 'yk-1', status: 'SUCCEEDED' }
        const { handler, gateway, payments } = build({ gateway: answer })
        await expect(run(handler)).resolves.toEqual({ received: true })
        expect(gateway.getPayment).toHaveBeenCalledWith(CREDS, 'yk-1')
        expect(payments.applyGateway).toHaveBeenCalledWith(answer)
    })
})
