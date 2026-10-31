import { z } from 'zod'

import { PlatformPlanSchema } from '../workspace-billing/schemas'

export const ListPlatformPlansOutputSchema = z.object({
    // false on a self-hosted install: plans are listed but nothing enforces
    // them, and a suspension does not lock anyone out.
    billingEnabled: z.boolean(),
    trialDays: z.number().int(),
    graceDays: z.number().int(),
    data: z.array(PlatformPlanSchema),
})

export class ListPlatformPlansFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPlatformPlansFeatureResponse = z.infer<
    typeof ListPlatformPlansOutputSchema
>
