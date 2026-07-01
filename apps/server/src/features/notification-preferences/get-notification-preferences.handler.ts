import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsPreferencesService } from '../../domains/notifications/services/preferences.service'
import {
    GetNotificationPreferencesFeature,
    GetNotificationPreferencesFeatureResponse,
} from './get-notification-preferences.feature'

@Feature(GetNotificationPreferencesFeature)
export class GetNotificationPreferencesHandler
    implements
        IFeatureHandler<
            GetNotificationPreferencesFeature,
            GetNotificationPreferencesFeatureResponse
        >
{
    constructor(
        private readonly preferences: NotificationsPreferencesService,
    ) {}

    async execute({
        userId,
    }: GetNotificationPreferencesFeature): Promise<GetNotificationPreferencesFeatureResponse> {
        return await this.preferences.getCategoryPreferences(userId)
    }
}
