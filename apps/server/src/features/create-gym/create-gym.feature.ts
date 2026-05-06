import { z } from 'zod'

export const CreateGymFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    address: z.string().trim().min(1).max(500),
    timezone: z.string().min(1).max(64).optional().nullable(),
})

export const CreateGymFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    timezone: z.string().nullable(),
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
