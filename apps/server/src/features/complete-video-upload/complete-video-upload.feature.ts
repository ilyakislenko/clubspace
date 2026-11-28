import { z } from 'zod'

import { S3_MAX_PARTS } from '../../domains/video/services/multipart-upload'

export const CompleteVideoUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    // A multipart upload (create returned method MULTIPART): every part's
    // number and the ETag storage answered its PUT with. Ignored for a single
    // PUT upload.
    parts: z
        .array(
            z.object({
                partNumber: z.number().int().min(1).max(S3_MAX_PARTS),
                etag: z.string().min(1).max(256),
            }),
        )
        .min(1)
        .max(S3_MAX_PARTS)
        .optional(),
})

export const CompleteVideoUploadFeatureOutputSchema = z.object({
    status: z.literal('queued'),
})

export type CompletedVideoUploadPart = NonNullable<
    z.infer<typeof CompleteVideoUploadFeatureInputSchema>['parts']
>[number]

export class CompleteVideoUploadFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
        readonly parts?: CompletedVideoUploadPart[],
    ) {}
}

export type CompleteVideoUploadFeatureResponse = z.infer<
    typeof CompleteVideoUploadFeatureOutputSchema
>
