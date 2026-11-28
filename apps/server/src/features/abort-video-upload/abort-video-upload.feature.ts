import { z } from 'zod'

export const AbortVideoUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
})

export const AbortVideoUploadFeatureOutputSchema = z.object({
    status: z.literal('aborted'),
})

export class AbortVideoUploadFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type AbortVideoUploadFeatureResponse = z.infer<
    typeof AbortVideoUploadFeatureOutputSchema
>
