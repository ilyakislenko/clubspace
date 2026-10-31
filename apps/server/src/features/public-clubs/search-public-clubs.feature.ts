import { z } from 'zod'

import { WorkspaceTypeSchema } from '../platform/schemas'
import { PublicClubSummarySchema } from './schemas'

export const PUBLIC_CLUBS_DEFAULT_PER_PAGE = 20
export const PUBLIC_CLUBS_MAX_PER_PAGE = 50

const optionalTerm = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .optional()
        .transform((v) => (v ? v : undefined))

export const SearchPublicClubsFeatureInputSchema = z.object({
    // Matched against the name and the city, case-insensitively.
    q: optionalTerm(100),
    city: optionalTerm(120),
    type: WorkspaceTypeSchema.optional(),
    curPage: z.coerce.number().int().positive().max(1000).optional(),
    perPage: z.coerce
        .number()
        .int()
        .positive()
        .max(PUBLIC_CLUBS_MAX_PER_PAGE)
        .optional(),
})

export const SearchPublicClubsFeatureOutputSchema = z.object({
    data: z.array(PublicClubSummarySchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // Every city that has a listed club, for the filter.
    cities: z.array(z.string()),
})

export class SearchPublicClubsFeature {
    constructor(
        readonly payload: z.infer<typeof SearchPublicClubsFeatureInputSchema>,
    ) {}
}

export type SearchPublicClubsFeatureResponse = z.infer<
    typeof SearchPublicClubsFeatureOutputSchema
>
