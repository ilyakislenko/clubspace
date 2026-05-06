import { z } from 'zod'

export const RemoveGroupCoachFeatureOutputSchema = z.object({
    status: z.literal('removed'),
})

export class RemoveGroupCoachFeature {
    constructor(
        readonly workspaceId: string,
        readonly groupId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RemoveGroupCoachFeatureResponse = z.infer<
    typeof RemoveGroupCoachFeatureOutputSchema
>
