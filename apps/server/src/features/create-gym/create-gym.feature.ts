import { z } from 'zod'

export const CreateGymFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    address: z.string().trim().min(1).max(500),
})

export const CreateGymFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
})

export class CreateGymFeature {
    constructor(
        readonly payload: z.infer<typeof CreateGymFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreateGymFeatureResponse = z.infer<
    typeof CreateGymFeatureOutputSchema
>
