import { z } from 'zod'

import { AchievementDeletedOutputSchema } from './schemas'

export const DeleteAchievementOutputSchema = AchievementDeletedOutputSchema

export class DeleteAchievementFeature {
    constructor(
        readonly workspaceId: string,
        readonly achievementId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteAchievementFeatureResponse = z.infer<
    typeof DeleteAchievementOutputSchema
>
