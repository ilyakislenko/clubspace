import { z } from 'zod'

import { LadderRosterEntrySchema } from './schemas'

export const GetLadderRosterOutputSchema = z.object({
    data: z.array(LadderRosterEntrySchema),
})

export class GetLadderRosterFeature {
    constructor(
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetLadderRosterFeatureResponse = z.infer<
    typeof GetLadderRosterOutputSchema
>
