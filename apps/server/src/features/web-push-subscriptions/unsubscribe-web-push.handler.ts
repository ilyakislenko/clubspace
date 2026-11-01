import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    UnsubscribeWebPushFeature,
    UnsubscribeWebPushFeatureResponse,
} from './web-push-subscriptions.feature'

@Feature(UnsubscribeWebPushFeature)
export class UnsubscribeWebPushHandler
    implements IFeatureHandler<UnsubscribeWebPushFeature, UnsubscribeWebPushFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, endpoint }: UnsubscribeWebPushFeature) {
        // Idempotent, and only the caller's own row.
        await this.prisma.webPushSubscription.deleteMany({
            where: { userId, endpoint },
        })
        return { status: 'removed' as const }
    }
}
