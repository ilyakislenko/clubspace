import { z } from 'zod'

const PlaylistVideoSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    duration: z.number().int().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    order: z.number().int(),
    chapterId: z.string().uuid().nullable(),
    // Denormalised: server resolves Chapter.title for the lesson's
    // chapterId so mobile clients keep working without joining tables.
    chapterTitle: z.string().nullable(),
})

const PlaylistChapterSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    order: z.number().int(),
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
    isPublic: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    tags: z.array(z.string()),
    chapters: z.array(PlaylistChapterSchema),
    videos: z.array(PlaylistVideoSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class GetPlaylistFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly isStaff: boolean,
    ) {}
}

export type GetPlaylistFeatureResponse = z.infer<
    typeof GetPlaylistFeatureOutputSchema
>
