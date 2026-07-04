import { z } from 'zod'

import { RankDeletedOutputSchema } from './schemas'

export const DeleteLadderOutputSchema = RankDeletedOutputSchema

export class DeleteLadderFeature {
    constructor(
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteLadderFeatureResponse = z.infer<
    typeof DeleteLadderOutputSchema
>
