import { Feature, IFeatureHandler } from '@shelfjs/features'
import { Logger } from '@nestjs/common'

import { AuditService } from '../../domains/audit/services/audit.service'
import { toGatewayCredentials } from '../../domains/payments/payment-credentials'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { paymentListInclude } from './list-payments.handler'
import {
    RefundPaymentFeature,
    RefundPaymentFeatureResponse,
} from './refund-payment.feature'
import { serializePayment } from './schemas'

// A full refund through the provider, then the Payment is marked REFUNDED. The
// abonement it created is left as is: whether the member keeps training (a
// goodwill refund) or loses access is the staff's call, made on the member's
// card.
@Feature(RefundPaymentFeature)
export class RefundPaymentHandler
    implements
        IFeatureHandler<RefundPaymentFeature, RefundPaymentFeatureResponse>
{
    private readonly logger = new Logger(RefundPaymentHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly gateway: PaymentGatewayClient,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: RefundPaymentFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const payment = await this.prisma.payment.findFirst({
            where: { id: f.paymentId, workspaceId: f.workspaceId },
        })
        if (!payment) throw new NotFoundError({ message: 'Платёж не найден' })
        if (payment.status !== 'SUCCEEDED' || !payment.providerPaymentId) {
            throw new BadRequestError({
                message:
                    payment.status === 'REFUNDED'
                        ? 'Деньги по этому платежу уже возвращены'
                        : 'Вернуть можно только проведённый платёж',
            })
        }
        const row = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        if (!row || row.provider !== payment.provider) {
            throw new BadRequestError({
                message:
                    'Платёжная система, через которую прошёл платёж, отключена — верните деньги в её личном кабинете',
            })
        }

        try {
            await this.gateway.refund(
                toGatewayCredentials(row, environment.encryptionKey),
                {
                    paymentId: payment.id,
                    providerPaymentId: payment.providerPaymentId,
                    amount: payment.amount,
                    currency: payment.currency,
                    // Stable per payment: a retried refund is the same refund.
                    idempotenceKey: `refund-${payment.id}`,
                },
            )
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(`Refund of payment ${payment.id} failed: ${err.message}`)
            throw new BadRequestError({
                message: `Платёжная система не провела возврат${
                    err.providerMessage ? `: ${err.providerMessage}` : ''
                }`,
            })
        }

        const refundedAt = new Date()
        // Compare-and-set: two admins pressing at once record one refund (the
        // provider call itself is idempotent on the key above).
        const res = await this.prisma.payment.updateMany({
            where: { id: payment.id, status: 'SUCCEEDED' },
            data: { status: 'REFUNDED', refundedAt },
        })
        if (res.count !== 1) {
            throw new BadRequestError({
                message: 'Деньги по этому платежу уже возвращены',
            })
        }

        await this.audit.record({
            action: 'payment.refund',
            targetType: 'member',
            targetId: payment.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                paymentId: payment.id,
                provider: payment.provider,
                planName: payment.planName,
                amount: payment.amount,
                currency: payment.currency,
                subscriptionId: payment.subscriptionId,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['payments'])

        const updated = await this.prisma.payment.findUniqueOrThrow({
            where: { id: payment.id },
            include: paymentListInclude,
        })
        return serializePayment(updated)
    }
}
