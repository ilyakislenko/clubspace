import { z } from 'zod'

export const CreateVideoUploadFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    title: z.string().min(1),
    description: z.string().optional(),
    // Constrain to video/* so the presigned PUT can't be used to drop an
    // arbitrary file (html, script, etc.) into the bucket, which — given the
    // bucket is publicly readable — would otherwise be served as-is.
    contentType: z
        .string()
        .regex(/^video\/[a-zA-Z0-9][a-zA-Z0-9.+-]*$/, {
            message: 'Загружать можно только видеофайлы',
        }),
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
