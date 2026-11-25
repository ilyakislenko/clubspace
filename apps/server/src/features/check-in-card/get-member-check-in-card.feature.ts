import { z } from 'zod'

import { CheckInCardSchema } from './schemas'

export const GetMemberCheckInCardOutputSchema = CheckInCardSchema

// A member's card for a sport lead to print (a child without a phone).
export class GetMemberCheckInCardFeature {
    constructor(
        readonly workspaceId: string,
        readonly targetUserId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetMemberCheckInCardFeatureResponse = z.infer<
    typeof GetMemberCheckInCardOutputSchema
>
