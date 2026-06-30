import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import {
    MarkNotificationsSeenFeature,
    MarkNotificationsSeenFeatureResponse,
} from './mark-notifications-seen.feature'

@Feature(MarkNotificationsSeenFeature)
export class MarkNotificationsSeenHandler
    implements
        IFeatureHandler<
            MarkNotificationsSeenFeature,
            MarkNotificationsSeenFeatureResponse
        >
{
    constructor(private readonly notifications: NotificationsService) {}

    async execute({
        userId,
        payload,
    }: MarkNotificationsSeenFeature): Promise<MarkNotificationsSeenFeatureResponse> {
        const updated = await this.notifications.markSeen({
            userId,
            ids: payload.ids,
        })
        return { updated }
    }
}
