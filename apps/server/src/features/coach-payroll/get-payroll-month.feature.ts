import { z } from 'zod'

import { MonthSchema, PayrollMonthOutputSchema } from './schemas'

export const GetPayrollMonthInputSchema = z.object({ month: MonthSchema })
export const GetPayrollMonthOutputSchema = PayrollMonthOutputSchema

export class GetPayrollMonthFeature {
    constructor(
        readonly payload: z.infer<typeof GetPayrollMonthInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetPayrollMonthFeatureResponse = z.infer<typeof GetPayrollMonthOutputSchema>
