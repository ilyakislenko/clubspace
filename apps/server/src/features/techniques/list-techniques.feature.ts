import { z } from 'zod'

export const ListTechniquesFeatureInputSchema = z.object({
    // Narrows the catalogue by English or Russian name.
    q: z.string().trim().max(100).optional(),
})

const CategorySchema = z.enum([
    'submissions',
    'guards',
    'passes',
    'sweeps',
    'takedowns',
    'positions',
    'escapes',
    'other',
])

export const ListTechniquesFeatureOutputSchema = z.object({
    // Categories in catalogue order; only techniques taught in lessons the
    // member may watch.
    categories: z.array(
        z.object({
            category: CategorySchema,
            label: z.string(),
            techniques: z.array(
                z.object({
                    key: z.string(),
                    en: z.string(),
                    ru: z.string().nullable(),
                    // Lessons that name it, and how often (chapters vs speech).
                    videoCount: z.number().int(),
                    chapterCount: z.number().int(),
                    speechCount: z.number().int(),
                }),
            ),
        }),
    ),
})

export class ListTechniquesFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
        readonly payload: z.infer<typeof ListTechniquesFeatureInputSchema>,
    ) {}
}

export type ListTechniquesFeatureResponse = z.infer<typeof ListTechniquesFeatureOutputSchema>
