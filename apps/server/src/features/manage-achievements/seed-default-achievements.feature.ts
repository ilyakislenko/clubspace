import { z } from 'zod'

import { ListAchievementsOutputSchema } from './list-achievements.feature'

// Optional body: which ladder to seed — a direction's, or club-wide when the
// direction is omitted/null. `.default({})`: a bodyless POST (Express 5 leaves
// req.body undefined) still seeds the club-wide ladder as before.
export const SeedDefaultAchievementsInputSchema = z
    .object({
        directionId: z.string().uuid().nullish(),
    })
    .default({})

// Seeds the built-in default ladder as real editable rows for that scope
// (no-op if the scope already has any). Returns the full list afterwards.
export const SeedDefaultAchievementsOutputSchema = ListAchievementsOutputSchema

export class SeedDefaultAchievementsFeature {
    constructor(
        readonly payload: z.infer<typeof SeedDefaultAchievementsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SeedDefaultAchievementsFeatureResponse = z.infer<
    typeof SeedDefaultAchievementsOutputSchema
>
