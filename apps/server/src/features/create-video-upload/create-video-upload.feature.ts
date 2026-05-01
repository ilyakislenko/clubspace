import { z } from 'zod'

export const CreateVideoUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    title: z.string().min(1),
    description: z.string().optional(),
    contentType: z.string().min(1),
})

export const CreateVideoUploadFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    rawKey: z.string(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreateVideoUploadFeature {
    constructor(
        readonly payload: z.infer<typeof CreateVideoUploadFeatureInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type CreateVideoUploadFeatureResponse = z.infer<
    typeof CreateVideoUploadFeatureOutputSchema
>
