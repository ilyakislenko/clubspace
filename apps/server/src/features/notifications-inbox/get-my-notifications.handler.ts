import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import { NotificationTypeEnum } from '../../infrastructure/prisma'
import {
    GetMyNotificationsFeature,
    GetMyNotificationsFeatureResponse,
} from './get-my-notifications.feature'

@Feature(GetMyNotificationsFeature)
export class GetMyNotificationsHandler
    implements
        IFeatureHandler<
            GetMyNotificationsFeature,
            GetMyNotificationsFeatureResponse
        >
{
    constructor(private readonly notifications: NotificationsService) {}

    async execute({
        userId,
        payload,
    }: GetMyNotificationsFeature): Promise<GetMyNotificationsFeatureResponse> {
        // In-app inbox shows only PUSH notifications — the device/in-app
        // channel. EMAIL rows store rendered HTML templates as their message
        // (and are delivered as emails), and TELEGRAM is its own channel;
        // neither belongs in the app's notification list.
        return await this.notifications.getNotifications({
            userId,
            types: [NotificationTypeEnum.PUSH],
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
    }
}
