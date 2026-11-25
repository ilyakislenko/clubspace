import { z } from 'zod'

import { MonthSchema, PayrollAdjustmentSchema, RATE_AMOUNT_MAX } from './schemas'

// A bonus (+) or deduction (−) for a coach in an open month.
export const AddPayrollAdjustmentInputSchema = z.object({
    month: MonthSchema,
    coachId: z.string().uuid(),
    amount: z
        .number()
        .int()
        .min(-RATE_AMOUNT_MAX)
        .max(RATE_AMOUNT_MAX)
        .refine((v) => v !== 0, 'Укажите сумму корректировки'),
    // The coach sees it when the club shows pay in the app.
    comment: z.string().trim().min(1).max(500),
})

export const AddPayrollAdjustmentOutputSchema = PayrollAdjustmentSchema.extend({
    month: z.string(),
    coachId: z.string().uuid(),
})

export class AddPayrollAdjustmentFeature {
    constructor(
        readonly payload: z.infer<typeof AddPayrollAdjustmentInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type AddPayrollAdjustmentFeatureResponse = z.infer<typeof AddPayrollAdjustmentOutputSchema>
