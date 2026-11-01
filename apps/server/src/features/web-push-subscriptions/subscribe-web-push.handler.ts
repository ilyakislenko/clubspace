import { Feature, IFeatureHandler } from '@shelfjs/features'

import { WebPushClient } from '../../domains/notifications/services/web-push.client'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    SubscribeWebPushFeature,
    SubscribeWebPushFeatureResponse,
} from './web-push-subscriptions.feature'

@Feature(SubscribeWebPushFeature)
export class SubscribeWebPushHandler
    implements IFeatureHandler<SubscribeWebPushFeature, SubscribeWebPushFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly webPush: WebPushClient,
    ) {}

    async execute({ userId, payload }: SubscribeWebPushFeature) {
        if (!this.webPush.publicKey) {
            throw new BadRequestError({
                message: 'Веб-уведомления на сервере не настроены',
            })
        }
        const data = {
            userId,
            p256dh: payload.p256dh,
            auth: payload.auth,
            userAgent: payload.userAgent ?? null,
        }
        // Keyed by endpoint: one browser profile is one subscription. A browser
        // that signed in as someone else moves the row to the new account, so
        // the previous one stops receiving here.
        await this.prisma.webPushSubscription.upsert({
            where: { endpoint: payload.endpoint },
            create: { endpoint: payload.endpoint, ...data },
            update: data,
        })
        return { status: 'subscribed' as const }
    }
}
