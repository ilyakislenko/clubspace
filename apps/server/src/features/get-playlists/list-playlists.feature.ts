import { z } from 'zod'

import { CourseLockSchema } from '../../domains/playlist/services/course-audience'

export const ListPlaylistsFeatureInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    q: z.string().min(1).max(200).optional(),
})

export const ListPlaylistsFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
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
            // Rank/plan teaser lock for this viewer; null = open. Courses
            // restricted to groups the viewer isn't in aren't listed at all.
            lock: CourseLockSchema.nullable(),
            // Staff only: who the course is meant for, null = the whole club.
            audienceSummary: z.string().nullable(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListPlaylistsFeature {
    constructor(
        readonly payload: z.infer<typeof ListPlaylistsFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly isStaff: boolean,
    ) {}
}

export type ListPlaylistsFeatureResponse = z.infer<
    typeof ListPlaylistsFeatureOutputSchema
>
