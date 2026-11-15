import { z } from 'zod'

import { MemberAutopaySchema } from './schemas'

// A member's autopay agreements on their card (sport leads); amounts and the
// card for club admins only.
export const ListMemberAutopaysOutputSchema = z.object({
    data: z.array(MemberAutopaySchema),
})

export class ListMemberAutopaysFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListMemberAutopaysFeatureResponse = z.infer<
    typeof ListMemberAutopaysOutputSchema
>
