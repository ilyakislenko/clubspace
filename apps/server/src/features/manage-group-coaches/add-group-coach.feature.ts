import { z } from 'zod'

export const AddGroupCoachFeatureInputSchema = z.object({
    userId: z.string().uuid(),
})

export const AddGroupCoachFeatureOutputSchema = z.object({
    groupId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.literal('assistant'),
})

export class AddGroupCoachFeature {
    constructor(
        readonly payload: z.infer<typeof AddGroupCoachFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddGroupCoachFeatureResponse = z.infer<
    typeof AddGroupCoachFeatureOutputSchema
>
