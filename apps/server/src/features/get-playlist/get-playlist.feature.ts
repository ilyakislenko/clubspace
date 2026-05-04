import { z } from 'zod'

const PlaylistVideoSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    duration: z.number().int().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    order: z.number().int(),
    chapterTitle: z.string().nullable().optional(),
})

export const GetPlaylistFeatureOutputSchema = z.object({
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
    tags: z.array(z.string()),
    videos: z.array(PlaylistVideoSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class GetPlaylistFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
    ) {}
}

export type GetPlaylistFeatureResponse = z.infer<
    typeof GetPlaylistFeatureOutputSchema
>
