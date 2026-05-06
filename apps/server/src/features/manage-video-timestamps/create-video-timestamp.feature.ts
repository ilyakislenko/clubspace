import { z } from 'zod'

export const CreateVideoTimestampFeatureInputSchema = z.object({
    positionSec: z.number().int().min(0),
    title: z.string().min(1).max(255),
})

export const VideoTimestampOutputSchema = z.object({
    id: z.string().uuid(),
    positionSec: z.number().int(),
    title: z.string(),
})

export class CreateVideoTimestampFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreateVideoTimestampFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly videoId: string,
    ) {}
}

export type VideoTimestampResponse = z.infer<typeof VideoTimestampOutputSchema>
