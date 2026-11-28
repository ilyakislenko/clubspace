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
    // Declared by the client: an oversized file is refused before upload, and
    // the size is signed into the upload URL so storage rejects anything else.
    // Optional so an admin bundle older than this field keeps working — the
    // real size is re-checked in completeUpload either way.
    sizeBytes: z.number().int().positive().optional(),
    // The client can upload in parts (see `upload` below). Only then does a
    // file bigger than one part get a MULTIPART answer: an admin bundle from
    // before multipart sends sizeBytes too, and expects `upload.url`.
    multipart: z.boolean().optional(),
})

export const CreateVideoUploadFeatureOutputSchema = z.object({
    videoId: z.string().uuid(),
    rawKey: z.string(),
    // Flat, not a union (keeps the contract free of oneOf):
    // - PUT: one presigned URL (`url`) for the whole file — a file no bigger
    //   than one part, no declared size, or a client that did not send
    //   `multipart: true`.
    // - MULTIPART: PUT each part to its URL — `partSize` bytes each, the last
    //   one shorter — and send every part's ETag to complete-upload; on
    //   cancel or failure call abort-upload.
    upload: z.object({
        method: z.enum(['PUT', 'MULTIPART']),
        url: z.string().url().optional(),
        uploadId: z.string().optional(),
        partSize: z.number().int().positive().optional(),
        parts: z
            .array(
                z.object({
                    partNumber: z.number().int().positive(),
                    url: z.string().url(),
                }),
            )
            .optional(),
    }),
})

export class CreateVideoUploadFeature {
    constructor(
        // workspaceId arrives separately, resolved by @RequestWorkspaceId().
        readonly payload: Omit<
            z.infer<typeof CreateVideoUploadFeatureInputSchema>,
            'workspaceId'
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreateVideoUploadFeatureResponse = z.infer<
    typeof CreateVideoUploadFeatureOutputSchema
>
