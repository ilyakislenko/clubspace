import { z } from 'zod'

export const RejectPendingMemberFeatureOutputSchema = z.object({
    status: z.literal('rejected'),
})

export class RejectPendingMemberFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RejectPendingMemberFeatureResponse = z.infer<
    typeof RejectPendingMemberFeatureOutputSchema
>
