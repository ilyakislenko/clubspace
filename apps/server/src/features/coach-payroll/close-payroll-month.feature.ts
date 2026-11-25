import { z } from 'zod'

import { PayrollMonthOutputSchema } from './schemas'

// What the admin confirmed: `expectedTotal`, and optionally every coach's
// total (`expectedLines`, the rows shown). A recomputation that differs in the
// total — or in any coach's total when the lines are sent — refuses the close
// (409 STALE_UPDATE), so offsetting changes are caught too.
export const ClosePayrollMonthInputSchema = z.object({
    expectedTotal: z.number().int(),
    expectedLines: z
        .array(z.object({ coachId: z.string().uuid(), total: z.number().int() }))
        .max(1000)
        .optional(),
})
export const ClosePayrollMonthOutputSchema = PayrollMonthOutputSchema

export class ClosePayrollMonthFeature {
    constructor(
        readonly payload: z.infer<typeof ClosePayrollMonthInputSchema>,
        readonly workspaceId: string,
        readonly month: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ClosePayrollMonthFeatureResponse = z.infer<typeof ClosePayrollMonthOutputSchema>
