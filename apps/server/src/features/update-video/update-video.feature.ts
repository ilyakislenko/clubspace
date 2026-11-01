import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'

export const UpdateVideoFeatureInputSchema = z.object({
    workspaceId: z.string().uuid(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    isPublic: strictBoolean().optional(),
    tagIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    playlistIds: z.array(z.string().uuid()).optional(),
    /** @deprecated use playlistIds instead. Kept for backward compatibility. */
    playlistId: z.string().uuid().nullable().optional(),
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

export const UpdateVideoFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    isPublic: z.boolean(),
    url: z.string(),
    duration: z.number().int().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    tags: z.array(TagSchema),
    categories: z.array(CategorySchema),
    playlists: z.array(PlaylistSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class UpdateVideoFeature {
    constructor(
        // workspaceId arrives separately, resolved by @RequestWorkspaceId().
        readonly payload: Omit<
            z.infer<typeof UpdateVideoFeatureInputSchema>,
            'workspaceId'
        >,
        readonly workspaceId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateVideoFeatureResponse = z.infer<
    typeof UpdateVideoFeatureOutputSchema
>
