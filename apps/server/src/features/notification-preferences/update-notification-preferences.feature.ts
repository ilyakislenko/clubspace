import { z } from 'zod'

import { NotificationPreferencesOutputSchema } from './get-notification-preferences.feature'

export const UpdateNotificationPreferencesFeatureInputSchema = z.object({
    newVideosEnabled: z.boolean().optional(),
    accessExpiringEnabled: z.boolean().optional(),
    promotionsEnabled: z.boolean().optional(),
    announcementsEnabled: z.boolean().optional(),
    inactivityEnabled: z.boolean().optional(),
})

export const UpdateNotificationPreferencesFeatureOutputSchema =
    NotificationPreferencesOutputSchema

export class UpdateNotificationPreferencesFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<
            typeof UpdateNotificationPreferencesFeatureInputSchema
        >,
    ) {}
}

export type UpdateNotificationPreferencesFeatureResponse = z.infer<
    typeof UpdateNotificationPreferencesFeatureOutputSchema
>
