import { GetMyAchievementsOutputSchema } from './get-my-achievements.feature'

// Staff-facing view of ONE member's achievements (the member's own view is
// get-my-achievements). Identical shape; the target member is a route param.
export const GetMemberAchievementsOutputSchema = GetMyAchievementsOutputSchema

export class GetMemberAchievementsFeature {
    constructor(
        readonly workspaceId: string,
        readonly memberUserId: string,
    ) {}
}

export type GetMemberAchievementsFeatureResponse = ReturnType<
    typeof GetMyAchievementsOutputSchema.parse
>
