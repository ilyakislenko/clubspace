import { z } from 'zod'

import { MemberRanksOutputSchema } from '../member-ranks/schemas'

export const GetMyRanksOutputSchema = MemberRanksOutputSchema

export class GetMyRanksFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyRanksFeatureResponse = z.infer<typeof GetMyRanksOutputSchema>
