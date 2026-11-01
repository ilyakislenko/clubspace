import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { serializePlatformPayment } from '../workspace-billing/schemas'
import {
    RefundPlatformWorkspacePaymentFeature,
    RefundPlatformWorkspacePaymentFeatureResponse,
} from './platform-workspace-payments.feature'

// A full or partial refund of a club's card payment through YooKassa,
// audited with the amount and the operator's reason.
@Feature(RefundPlatformWorkspacePaymentFeature)
export class RefundPlatformWorkspacePaymentHandler
    implements IFeatureHandler<RefundPlatformWorkspacePaymentFeature, RefundPlatformWorkspacePaymentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: RefundPlatformWorkspacePaymentFeature): Promise<RefundPlatformWorkspacePaymentFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const payment = await this.payments.refund({
            workspaceId: f.workspaceId,
            paymentId: f.paymentId,
            amount: f.payload.amount,
            reason: f.payload.reason,
            actorId: f.invokerUserId,
        })
        return serializePlatformPayment(payment)
    }
}
