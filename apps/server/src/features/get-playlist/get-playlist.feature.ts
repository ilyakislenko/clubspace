import { z } from 'zod'

import { CourseLockSchema } from '../../domains/playlist/services/course-audience'

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
    // Optional lessons never gate the next one under locked progression.
    isOptional: z.boolean(),
    // Why this lesson can't be opened yet (course audience or locked
    // progression); null = playable. Always null for staff.
    lock: CourseLockSchema.nullable(),
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
    level: z.string().nullable().optional(),
    lockedProgression: z.boolean(),
    isPublic: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    tags: z.array(z.string()),
    // Course-level lock for this viewer (rank/plan teaser); null = open.
    lock: CourseLockSchema.nullable(),
    // Staff only: who the course is meant for, null = the whole club.
    audienceSummary: z.string().nullable(),
    chapters: z.array(PlaylistChapterSchema),
    videos: z.array(PlaylistVideoSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class GetPlaylistFeature {
    constructor(
        readonly workspaceId: string,
        readonly playlistId: string,
        readonly invokerUserId: string,
        readonly isStaff: boolean,
    ) {}
}

export type GetPlaylistFeatureResponse = z.infer<
    typeof GetPlaylistFeatureOutputSchema
>
