import { z } from 'zod'

import { DiscountKindSchema } from '../discounts/schemas'

export const ListSaleDiscountsInputSchema = z.object({
    // A ticket of this event; omitted = the club's active tariffs.
    eventId: z.string().uuid().optional(),
})

// One thing the discount prices for this member: a tariff or the event's
// ticket. `amount` is computed by the server (clients never re-implement it).
export const SaleDiscountItemSchema = z.object({
    planId: z.string().uuid().nullable(),
    eventId: z.string().uuid().nullable(),
    listPrice: z.number().int(),
    amount: z.number().int(),
    currency: z.string(),
})

export const SaleDiscountOptionSchema = z.object({
    discountId: z.string().uuid(),
    name: z.string(),
    kind: DiscountKindSchema,
    value: z.number().int(),
    code: z.string().nullable(),
    isFamily: z.boolean(),
    endsOn: z.iso.date().nullable(),
    items: z.array(SaleDiscountItemSchema),
})

export const ListSaleDiscountsOutputSchema = z.object({
    // Another family member holds a current abonement (the relative is not
    // named: a scoped coach may not see them). The form preselects the
    // family option then.
    familyEligible: z.boolean(),
    // Active discounts usable for this member today, with at least one item;
    // a limit already reached (once per member, max uses) leaves it out.
    // Family first, then by name.
    options: z.array(SaleDiscountOptionSchema),
})

export class ListSaleDiscountsFeature {
    constructor(
        readonly payload: z.infer<typeof ListSaleDiscountsInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListSaleDiscountsFeatureResponse = z.infer<typeof ListSaleDiscountsOutputSchema>
