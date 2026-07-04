import { z } from 'zod'

import { MemberSubscriptionsOutputSchema } from './schemas'

export const ListMemberSubscriptionsOutputSchema =
    MemberSubscriptionsOutputSchema

export class ListMemberSubscriptionsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListMemberSubscriptionsFeatureResponse = z.infer<
    typeof ListMemberSubscriptionsOutputSchema
>
