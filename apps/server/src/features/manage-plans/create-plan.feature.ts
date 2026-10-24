import { z } from 'zod'

import { PlanOutputSchema } from './schemas'

export const CreatePlanInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable().optional(),
    price: z.number().int().min(0),
    currency: z.string().trim().length(3),
    durationDays: z.number().int().positive().max(3650),
    // Class-pack size (null / omitted = time-only tariff).
    classCount: z.number().int().positive().max(1000).nullable().optional(),
    isFreeTrial: z.boolean().optional(),
    startsOnFirstVisit: z.boolean().optional(),
    isActive: z.boolean().optional(),
})
export const CreatePlanOutputSchema = PlanOutputSchema

export class CreatePlanFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePlanInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreatePlanFeatureResponse = z.infer<typeof CreatePlanOutputSchema>
