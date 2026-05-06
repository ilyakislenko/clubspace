import { z } from 'zod'

import { VideoTimestampOutputSchema } from './create-video-timestamp.feature'

export const UpdateVideoTimestampFeatureInputSchema = z.object({
    positionSec: z.number().int().min(0).optional(),
    title: z.string().min(1).max(255).optional(),
})

export class UpdateVideoTimestampFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateVideoTimestampFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly videoId: string,
        readonly timestampId: string,
    ) {}
}

export { VideoTimestampOutputSchema }
export type { VideoTimestampResponse } from './create-video-timestamp.feature'
