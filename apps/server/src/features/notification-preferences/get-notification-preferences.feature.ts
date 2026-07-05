import { z } from 'zod'

export const NotificationPreferencesOutputSchema = z.object({
    newVideosEnabled: z.boolean(),
    accessExpiringEnabled: z.boolean(),
    promotionsEnabled: z.boolean(),
    announcementsEnabled: z.boolean(),
    inactivityEnabled: z.boolean(),
})

export const GetNotificationPreferencesFeatureOutputSchema =
    NotificationPreferencesOutputSchema

export class GetNotificationPreferencesFeature {
    constructor(readonly userId: string) {}
}

export type GetNotificationPreferencesFeatureResponse = z.infer<
    typeof GetNotificationPreferencesFeatureOutputSchema
>
