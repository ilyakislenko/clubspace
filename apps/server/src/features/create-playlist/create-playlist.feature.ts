import { z } from 'zod'

export const CreatePlaylistFeatureInputSchema = z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().optional(),
    thumbnailUrl: z.string().url().optional(),
    status: z.string().optional(),
    accessLevel: z.string().optional(),
    level: z.string().optional(),
    lockedProgression: z.boolean().optional(),
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
    tags: z.array(z.string()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export class CreatePlaylistFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePlaylistFeatureInputSchema>,
        readonly workspaceId: string,
    ) {}
}

export type CreatePlaylistFeatureResponse = z.infer<
    typeof CreatePlaylistFeatureOutputSchema
>
