import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsService } from '../../domains/notifications/services/notifications.service'
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
        return await this.notifications.getNotifications({
            userId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
    }
}
