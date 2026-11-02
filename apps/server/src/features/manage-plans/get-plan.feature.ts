import { z } from 'zod'

import { PlanOutputSchema } from './schemas'

// Who holds an abonement of the tariff now.
const PlanHolderSchema = z.object({
    subscriptionId: z.string().uuid(),
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    // null = waits for the first visit.
    startDate: z.iso.datetime().nullable(),
    endDate: z.iso.datetime().nullable(),
    durationDays: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    classesTotal: z.number().int().nullable(),
    classesRemaining: z.number().int().nullable(),
    isPaid: z.boolean(),
})

// The tariff page: the tariff, its current abonements and the last 30 days
// of sales.
export const GetPlanOutputSchema = z.object({
    plan: PlanOutputSchema,
    holders: z.array(PlanHolderSchema),
    last30Days: z.object({
        // Abonements sold (any payment state, cancelled ones excluded).
        sold: z.number().int(),
        // Money received, in the tariff's currency (revenue.ts rules).
        revenue: z.number().int(),
    }),
})

export class GetPlanFeature {
    constructor(
        readonly workspaceId: string,
        readonly planId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetPlanFeatureResponse = z.infer<typeof GetPlanOutputSchema>
