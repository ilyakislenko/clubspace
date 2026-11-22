import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import { DiscountOutputSchema, DiscountStaffSummarySchema } from './schemas'

export const ListDiscountsInputSchema = z.object({
    // true = archived discounts too («Показать архив»); default: active only.
    archived: strictBoolean().optional(),
    // «Кто давал скидки» period: club-local days, both or neither (neither =
    // the `revenue_30d` window), at most a year — the payments journal's rule.
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
})

export const ListDiscountsOutputSchema = z.object({
    // Active first, newest first; at most 200.
    data: z.array(DiscountOutputSchema),
    // Who reduced prices in the period, by one-off amount (≤ 50 rows).
    byStaff: z.array(DiscountStaffSummarySchema),
})

export class ListDiscountsFeature {
    constructor(
        readonly payload: z.infer<typeof ListDiscountsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListDiscountsFeatureResponse = z.infer<typeof ListDiscountsOutputSchema>
