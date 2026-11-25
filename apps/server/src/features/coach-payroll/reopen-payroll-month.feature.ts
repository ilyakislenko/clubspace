import { z } from 'zod'

import { PayrollMonthOutputSchema } from './schemas'

export const ReopenPayrollMonthInputSchema = z.object({
    // Why the frozen month is reopened (kept in the audit with the old totals).
    reason: z.string().trim().min(3).max(500),
})
export const ReopenPayrollMonthOutputSchema = PayrollMonthOutputSchema

export class ReopenPayrollMonthFeature {
    constructor(
        readonly payload: z.infer<typeof ReopenPayrollMonthInputSchema>,
        readonly workspaceId: string,
        readonly month: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ReopenPayrollMonthFeatureResponse = z.infer<typeof ReopenPayrollMonthOutputSchema>
