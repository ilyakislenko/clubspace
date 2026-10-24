import { z } from 'zod'

import { PlanOutputSchema } from './schemas'

export const UpdatePlanInputSchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(5000).nullable().optional(),
        price: z.number().int().min(0).optional(),
        currency: z.string().trim().length(3).optional(),
        durationDays: z.number().int().positive().max(3650).optional(),
        classCount: z.number().int().positive().max(1000).nullable().optional(),
        isFreeTrial: z.boolean().optional(),
        startsOnFirstVisit: z.boolean().optional(),
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdatePlanOutputSchema = PlanOutputSchema

export class UpdatePlanFeature {
    constructor(
        readonly payload: z.infer<typeof UpdatePlanInputSchema>,
        readonly workspaceId: string,
        readonly planId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdatePlanFeatureResponse = z.infer<typeof UpdatePlanOutputSchema>
