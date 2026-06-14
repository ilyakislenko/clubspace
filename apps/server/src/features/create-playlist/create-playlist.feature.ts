import { z } from 'zod'

export const CreatePlaylistFeatureInputSchema = z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    // nullable to match update-playlist (and the create-category/tag inputs):
    // the admin form sends null to leave an optional field empty, and the
    // backing columns are nullable.
    description: z.string().nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    status: z.string().nullable().optional(),
    accessLevel: z.string().nullable().optional(),
    level: z.string().nullable().optional(),
    lockedProgression: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    publishedAt: z.iso.datetime().nullable().optional(),
    tags: z.array(z.string()).optional(),
})

export const CreatePlaylistFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string(),
    slug: z.string(),
    description: z.string().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    accessLevel: z.string().nullable().optional(),
    level: z.string().nullable().optional(),
    lockedProgression: z.boolean(),
    isPublic: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    tags: z.array(z.string()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class CreatePlaylistFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePlaylistFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreatePlaylistFeatureResponse = z.infer<
    typeof CreatePlaylistFeatureOutputSchema
>
