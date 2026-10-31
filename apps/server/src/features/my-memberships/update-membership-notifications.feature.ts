import { z } from 'zod'

export const UpdateMembershipNotificationsInputSchema = z.object({
    muted: z.boolean(),
})

export const UpdateMembershipNotificationsOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    notificationsMuted: z.boolean(),
})

export class UpdateMembershipNotificationsFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMembershipNotificationsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateMembershipNotificationsFeatureResponse = z.infer<
    typeof UpdateMembershipNotificationsOutputSchema
>
