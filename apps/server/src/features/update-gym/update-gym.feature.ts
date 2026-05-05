import { z } from 'zod'

export const UpdateGymFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    address: z.string().trim().min(1).max(500).optional(),
})

export const UpdateGymFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
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
