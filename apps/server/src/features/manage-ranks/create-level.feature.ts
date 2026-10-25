import { z } from 'zod'

import { RankLevelOutputSchema } from './schemas'

export const CreateLevelInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    order: z.number().int().min(0),
    color: z.string().trim().max(32).nullable().optional(),
    maxStripes: z.number().int().min(0).max(20).optional(),
    requirements: z.string().trim().max(5000).nullable().optional(),
    minVisits: z.number().int().min(1).max(5000).nullable().optional(),
    minWeeks: z.number().int().min(1).max(520).nullable().optional(),
})
export const CreateLevelOutputSchema = RankLevelOutputSchema

export class CreateLevelFeature {
    constructor(
        readonly payload: z.infer<typeof CreateLevelInputSchema>,
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateLevelFeatureResponse = z.infer<
    typeof CreateLevelOutputSchema
>
