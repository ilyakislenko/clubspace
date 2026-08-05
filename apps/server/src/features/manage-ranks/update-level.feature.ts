import { z } from 'zod'

import { RankLevelOutputSchema } from './schemas'

export const UpdateLevelInputSchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        order: z.number().int().min(0).optional(),
        color: z.string().trim().max(32).nullable().optional(),
        maxStripes: z.number().int().min(0).max(20).optional(),
        requirements: z.string().trim().max(5000).nullable().optional(),
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdateLevelOutputSchema = RankLevelOutputSchema

export class UpdateLevelFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateLevelInputSchema>,
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly levelId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateLevelFeatureResponse = z.infer<
    typeof UpdateLevelOutputSchema
>
