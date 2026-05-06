import { z } from 'zod'

export const UpdateGymFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    timezone: z.string().min(1).max(64).nullable().optional(),
})

export const UpdateGymFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    timezone: z.string().nullable(),
})

export class UpdateGymFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateGymFeatureInputSchema>,
        readonly workspaceId: string,
        readonly gymId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateGymFeatureResponse = z.infer<
    typeof UpdateGymFeatureOutputSchema
>
