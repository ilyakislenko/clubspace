import { z } from 'zod'

export const ListPlaylistsFeatureInputSchema = z.object({
    curPage: z.number().int().positive().optional(),
    perPage: z.number().int().positive().optional(),
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
            accessLevel: z.string().nullable().optional(),
            level: z.string().nullable().optional(),
            lockedProgression: z.boolean(),
            tags: z.array(z.string()),
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
    ) {}
}

export type ListPlaylistsFeatureResponse = z.infer<
    typeof ListPlaylistsFeatureOutputSchema
>
