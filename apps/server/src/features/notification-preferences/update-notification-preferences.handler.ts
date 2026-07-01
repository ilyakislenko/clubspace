import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsPreferencesService } from '../../domains/notifications/services/preferences.service'
import {
    UpdateNotificationPreferencesFeature,
    UpdateNotificationPreferencesFeatureResponse,
} from './update-notification-preferences.feature'

@Feature(UpdateNotificationPreferencesFeature)
export class UpdateNotificationPreferencesHandler
    implements
        IFeatureHandler<
            UpdateNotificationPreferencesFeature,
            UpdateNotificationPreferencesFeatureResponse
        >
{
    constructor(
        private readonly preferences: NotificationsPreferencesService,
    ) {}

    async execute({
        userId,
        payload,
    }: UpdateNotificationPreferencesFeature): Promise<UpdateNotificationPreferencesFeatureResponse> {
        return await this.preferences.updateCategoryPreferences(userId, payload)
    }
}
