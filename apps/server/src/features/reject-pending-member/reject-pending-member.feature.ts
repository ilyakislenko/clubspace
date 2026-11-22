import { z } from 'zod'

// The body is optional: the mobile app rejects without one.
export const RejectPendingMemberInputSchema = z.object({
    // Shown to the applicant in the «заявка отклонена» notice.
    comment: z.string().trim().max(500).optional(),
})
export type RejectPendingMemberInputPayload = z.infer<typeof RejectPendingMemberInputSchema>

export const RejectPendingMemberFeatureOutputSchema = z.object({
    status: z.literal('rejected'),
})

export class RejectPendingMemberFeature {
    constructor(
        readonly payload: RejectPendingMemberInputPayload,
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
