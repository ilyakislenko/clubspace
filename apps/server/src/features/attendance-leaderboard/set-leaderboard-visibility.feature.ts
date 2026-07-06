import { z } from 'zod'

export const SetLeaderboardVisibilityInputSchema = z.object({
    // true = hide me from the board (opt out); false = show me.
    hidden: z.boolean(),
})

export const SetLeaderboardVisibilityOutputSchema = z.object({
    hidden: z.boolean(),
})

export class SetLeaderboardVisibilityFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly hidden: boolean,
    ) {}
}

export type SetLeaderboardVisibilityFeatureResponse = z.infer<
    typeof SetLeaderboardVisibilityOutputSchema
>
