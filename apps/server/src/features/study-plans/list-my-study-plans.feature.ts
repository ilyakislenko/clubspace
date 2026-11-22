import { z } from 'zod'

export const ListMyStudyPlansFeatureOutputSchema = z.object({
    items: z.array(
        z.object({
            id: z.string().uuid(),
            title: z.string(),
            description: z.string().nullable(),
            itemCount: z.number().int(),
            // The first item's lesson cover, when the member may watch it.
            coverUrl: z.string().nullable(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
        }),
    ),
})

export class ListMyStudyPlansFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
    ) {}
}

export type ListMyStudyPlansFeatureResponse = z.infer<
    typeof ListMyStudyPlansFeatureOutputSchema
>
