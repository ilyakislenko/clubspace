import { z } from 'zod'

export const DeleteDiscountOutputSchema = z.object({ status: z.literal('deleted') })

export class DeleteDiscountFeature {
    constructor(
        readonly workspaceId: string,
        readonly discountId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteDiscountFeatureResponse = z.infer<typeof DeleteDiscountOutputSchema>
