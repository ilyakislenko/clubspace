import { z } from 'zod'

import { GroupDetailsSchema } from './schemas'

// The group card. The roster is paged separately
// (`GET groups/:groupId/members`).
export const GetGroupOutputSchema = GroupDetailsSchema.extend({
    // The caller runs the group (admin scope, its coach, or the manager of
    // its direction): may edit it and sees the roster's abonements and risk.
    canEdit: z.boolean(),
})

export class GetGroupFeature {
    constructor(
        readonly groupId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetGroupFeatureResponse = z.infer<typeof GetGroupOutputSchema>
