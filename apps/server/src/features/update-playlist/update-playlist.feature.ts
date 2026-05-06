import { z } from 'zod'

export const UpdatePlaylistFeatureInputSchema = z.object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    status: z.string().nullable().optional(),
    accessLevel: z.string().nullable().optional(),
    level: z.string().nullable().optional(),
    lockedProgression: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
})

export const UpdatePlaylistFeatureOutputSchema = z.object({
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
    tags: z.array(z.string()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class UpdatePlaylistFeature {
    constructor(
        readonly payload: z.infer<typeof UpdatePlaylistFeatureInputSchema>,
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdatePlaylistFeatureResponse = z.infer<
    typeof UpdatePlaylistFeatureOutputSchema
>
