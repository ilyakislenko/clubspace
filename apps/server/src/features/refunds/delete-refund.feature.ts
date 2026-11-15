import { z } from 'zod'

export const DeleteRefundOutputSchema = z.object({ status: z.literal('deleted') })

// Removes a mistaken offline refund record; an online refund is final.
export class DeleteRefundFeature {
    constructor(
        readonly refundId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteRefundFeatureResponse = z.infer<typeof DeleteRefundOutputSchema>
