import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetMyPaymentFeature,
    GetMyPaymentFeatureResponse,
} from './get-my-payment.feature'
import { serializeMyPayment } from './schemas'

// The return screen polls this until the webhook settles the payment. Only the
// buyer's own payments in this club.
@Feature(GetMyPaymentFeature)
export class GetMyPaymentHandler
    implements IFeatureHandler<GetMyPaymentFeature, GetMyPaymentFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyPaymentFeature) {
        const payment = await this.prisma.payment.findFirst({
            where: {
                id: f.paymentId,
                workspaceId: f.workspaceId,
                userId: f.userId,
            },
        })
        if (!payment) throw new NotFoundError({ message: 'Платёж не найден' })
        return serializeMyPayment(payment)
    }
}
