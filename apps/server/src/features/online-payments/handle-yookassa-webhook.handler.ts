import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { toGatewayCredentials } from '../../domains/payments/payment-credentials'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { PaymentActivationService } from '../../domains/payments/services/payment-activation.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import {
    HandleYookassaWebhookFeature,
    PaymentWebhookFeatureResponse,
} from './handle-payment-webhook.feature'

// Only the id is read from the notification; everything else comes from
// YooKassa's API.
const NotificationSchema = z.object({
    object: z.object({ id: z.string().min(1).max(255) }),
})

// YooKassa HTTP notifications carry no signature. Anyone can post one, so the
// body is never trusted: the payment is re-read from the API with the club's
// own credentials and that answer is what gets applied.
@Feature(HandleYookassaWebhookFeature)
export class HandleYookassaWebhookHandler
    implements
        IFeatureHandler<
            HandleYookassaWebhookFeature,
            PaymentWebhookFeatureResponse
        >
{
    private readonly logger = new Logger(HandleYookassaWebhookHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
        private readonly activation: PaymentActivationService,
    ) {}

    async execute(
        f: HandleYookassaWebhookFeature,
    ): Promise<PaymentWebhookFeatureResponse> {
        const parsed = NotificationSchema.safeParse(f.body)
        if (!parsed.success) {
            throw new BadRequestError({ message: 'Malformed notification' })
        }
        const settings = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        if (!settings || settings.provider !== 'YOOKASSA') {
            throw new NotFoundError({ message: 'YooKassa is not connected' })
        }
        const providerPaymentId = parsed.data.object.id
        // Not one of ours (a refund notification, another integration of the
        // same shop): acknowledge without calling YooKassa.
        const known = await this.prisma.payment.findFirst({
            where: { workspaceId: f.workspaceId, providerPaymentId },
            select: { id: true },
        })
        if (!known) return { received: true }

        let gateway
        try {
            gateway = await this.gateway.getPayment(
                toGatewayCredentials(settings, environment.encryptionKey),
                providerPaymentId,
            )
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            // A 5xx makes YooKassa deliver the notification again later.
            this.logger.warn(
                `YooKassa re-read of ${providerPaymentId} failed: ${err.message}`,
            )
            throw new UnexpectedError({ message: 'Payment status unavailable' })
        }
        if (gateway.providerPaymentId !== providerPaymentId) {
            return { received: true }
        }
        await this.activation.applyProviderStatus({
            workspaceId: f.workspaceId,
            gateway,
        })
        return { received: true }
    }
}
