import { z } from 'zod'

import { MemberRanksOutputSchema } from './schemas'

export const GetMemberRanksOutputSchema = MemberRanksOutputSchema

export class GetMemberRanksFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetMemberRanksFeatureResponse = z.infer<
    typeof GetMemberRanksOutputSchema
>
