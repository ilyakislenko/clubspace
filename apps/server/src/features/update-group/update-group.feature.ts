import { z } from 'zod'

export const UpdateGroupFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    gymId: z.string().uuid().optional(),
    coachId: z.string().uuid().optional(),
    scheduleText: z.string().trim().max(500).nullable().optional(),
})

export const UpdateGroupFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gymId: z.string().uuid().nullable(),
    coachId: z.string().uuid(),
    scheduleText: z.string().nullable(),
})

export class UpdateGroupFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateGroupFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateGroupFeatureResponse = z.infer<
    typeof UpdateGroupFeatureOutputSchema
>
