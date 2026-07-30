import { z } from 'zod'

import { ListAchievementsOutputSchema } from './list-achievements.feature'

// Seeds the built-in default ladder as real editable rows (no-op if the club
// already has any). Returns the full list afterwards.
export const SeedDefaultAchievementsOutputSchema = ListAchievementsOutputSchema

export class SeedDefaultAchievementsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SeedDefaultAchievementsFeatureResponse = z.infer<
    typeof SeedDefaultAchievementsOutputSchema
>
