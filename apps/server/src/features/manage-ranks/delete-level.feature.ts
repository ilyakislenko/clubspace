import { z } from 'zod'

import { RankDeletedOutputSchema } from './schemas'

export const DeleteLevelOutputSchema = RankDeletedOutputSchema

export class DeleteLevelFeature {
    constructor(
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly levelId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteLevelFeatureResponse = z.infer<
    typeof DeleteLevelOutputSchema
>
