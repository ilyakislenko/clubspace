import { z } from 'zod'

export const CompleteVideoUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
})

export const CompleteVideoUploadFeatureOutputSchema = z.object({
    status: z.literal('queued'),
})

export class CompleteVideoUploadFeature {
    constructor(
        readonly payload: z.infer<typeof CompleteVideoUploadFeatureInputSchema>,
        readonly videoId: string,
    ) {}
}

export type CompleteVideoUploadFeatureResponse = z.infer<
    typeof CompleteVideoUploadFeatureOutputSchema
>
