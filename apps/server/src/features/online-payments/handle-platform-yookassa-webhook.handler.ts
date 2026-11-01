import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { platformGatewayCredentials } from '../../domains/billing/platform-payment-credentials'
import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import {
    HandlePlatformYookassaWebhookFeature,
    PaymentWebhookFeatureResponse,
} from './handle-payment-webhook.feature'

const NotificationSchema = z.object({
    object: z.object({ id: z.string().min(1).max(255) }),
})

// Notifications of the platform's own YooKassa shop. Unsigned, so never
// trusted: only the payment id is read, the payment is re-read from YooKassa
// with the platform's credentials and that answer is applied
// (PlatformPaymentsService.applyGateway — idempotent).
@Feature(HandlePlatformYookassaWebhookFeature)
export class HandlePlatformYookassaWebhookHandler
    implements
        IFeatureHandler<
            HandlePlatformYookassaWebhookFeature,
            PaymentWebhookFeatureResponse
        >
{
    private readonly logger = new Logger(HandlePlatformYookassaWebhookHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(
        f: HandlePlatformYookassaWebhookFeature,
    ): Promise<PaymentWebhookFeatureResponse> {
        const parsed = NotificationSchema.safeParse(f.body)
        if (!parsed.success) {
            throw new BadRequestError({ message: 'Malformed notification' })
        }
        const creds = platformGatewayCredentials()
        if (!creds) {
            throw new NotFoundError({ message: 'Platform payments are not configured' })
        }
        const providerPaymentId = parsed.data.object.id
        // Not one of ours (a refund notification, another integration of the
        // shop): acknowledge without calling YooKassa.
        const known = await this.prisma.platformPayment.findUnique({
            where: { providerPaymentId },
            select: { id: true },
        })
        if (!known) return { received: true }

        let gateway
        try {
            gateway = await this.gateway.getPayment(creds, providerPaymentId)
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            // A 5xx makes YooKassa deliver the notification again later.
            this.logger.warn(
                `YooKassa re-read of platform payment ${providerPaymentId} failed: ${err.message}`,
            )
            throw new UnexpectedError({ message: 'Payment status unavailable' })
        }
        if (gateway.providerPaymentId === providerPaymentId) {
            await this.payments.applyGateway(gateway)
        }
        return { received: true }
    }
}
