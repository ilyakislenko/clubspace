import { z } from 'zod'

import { PaymentOutputSchema, PaymentStatusSchema } from './schemas'

export const ListPaymentsInputSchema = z.object({
    status: PaymentStatusSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    perPage: z.coerce.number().int().min(1).max(100).optional(),
})
export const ListPaymentsOutputSchema = z.object({
    data: z.array(PaymentOutputSchema),
    total: z.number().int(),
    page: z.number().int(),
    perPage: z.number().int(),
})

export class ListPaymentsFeature {
    constructor(
        readonly payload: z.infer<typeof ListPaymentsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPaymentsFeatureResponse = z.infer<typeof ListPaymentsOutputSchema>
