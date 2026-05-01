import { z } from 'zod'

export const DeleteVideoFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
})

export const DeleteVideoFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteVideoFeature {
    constructor(
        readonly payload: z.infer<typeof DeleteVideoFeatureInputSchema>,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DeleteVideoFeatureResponse = z.infer<
    typeof DeleteVideoFeatureOutputSchema
>
