import { z } from 'zod'

export const DeletePayrollAdjustmentOutputSchema = z.object({ status: z.literal('deleted') })

export class DeletePayrollAdjustmentFeature {
    constructor(
        readonly workspaceId: string,
        readonly adjustmentId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeletePayrollAdjustmentFeatureResponse = z.infer<
    typeof DeletePayrollAdjustmentOutputSchema
>
