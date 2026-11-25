import { z } from 'zod'

import { PayrollAmountsSchema, PayrollRateSchema } from './schemas'

// «Мои выплаты»: the invoker's last 12 closed months, and this month's
// counts without money (a preliminary sum invites disputes).
export const GetMyPayrollOutputSchema = z.object({
    months: z.array(
        z.object({
            month: z.string(),
            closedAt: z.iso.datetime(),
            currency: z.string(),
            rate: PayrollRateSchema.nullable(),
            classes: z.number().int(),
            classesPaid: z.number().int(),
            marks: z.number().int(),
            marksPaid: z.number().int(),
            revenueBase: z.number().int(),
            amounts: PayrollAmountsSchema,
            total: z.number().int(),
            adjustments: z.array(
                z.object({
                    id: z.string().uuid(),
                    amount: z.number().int(),
                    comment: z.string(),
                    createdAt: z.iso.datetime(),
                }),
            ),
        }),
    ),
    current: z.object({
        month: z.string(),
        classes: z.number().int(),
        marks: z.number().int(),
    }),
})

export class GetMyPayrollFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetMyPayrollFeatureResponse = z.infer<typeof GetMyPayrollOutputSchema>
