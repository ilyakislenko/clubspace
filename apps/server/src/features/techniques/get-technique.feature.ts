import { z } from 'zod'

const HighlightSchema = z.object({ start: z.number().int(), length: z.number().int() })

export const GetTechniqueFeatureOutputSchema = z.object({
    technique: z.object({
        key: z.string(),
        en: z.string(),
        ru: z.string().nullable(),
        category: z.string(),
        categoryLabel: z.string(),
    }),
    // Lessons with a chapter on it first, then the ones that talk about it most.
    items: z.array(
        z.object({
            video: z.object({
                id: z.string().uuid(),
                title: z.string(),
                thumbnailUrl: z.string().nullable(),
                duration: z.number().int().nullable(),
            }),
            course: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
            chapterHits: z.number().int(),
            speechHits: z.number().int(),
            // Its chapters first, then where it's said.
            moments: z.array(
                z.object({
                    atSec: z.number().int(),
                    kind: z.enum(['chapter', 'speech', 'speechRu']),
                    snippet: z.string(),
                    highlight: HighlightSchema.nullable(),
                }),
            ),
        }),
    ),
})

export class GetTechniqueFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly techniqueKey: string,
        // Staff see every course when we pick the one a lesson belongs to.
        readonly isStaff: boolean,
    ) {}
}

export type GetTechniqueFeatureResponse = z.infer<typeof GetTechniqueFeatureOutputSchema>
