import { z } from 'zod'

export const ListVideosFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().optional(),
})

const TagSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    type: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

const CategorySchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string().uuid().nullable().optional(),
    order: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

const PlaylistSchema = z.object({
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
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export const ListVideosFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid(),
            title: z.string(),
            description: z.string().nullable().optional(),
            status: z.string(),
            url: z.string(),
            duration: z.number().int().nullable().optional(),
            thumbnailUrl: z.string().nullable().optional(),
            errorMessage: z.string().nullable().optional(),
            tags: z.array(TagSchema),
            categories: z.array(CategorySchema),
            playlists: z.array(PlaylistSchema),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListVideosFeature {
    constructor(
        readonly payload: z.infer<typeof ListVideosFeatureInputSchema>,
    ) {}
}

export type ListVideosFeatureResponse = z.infer<
    typeof ListVideosFeatureOutputSchema
>
