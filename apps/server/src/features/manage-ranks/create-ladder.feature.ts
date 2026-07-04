import { z } from 'zod'

import { RankLadderOutputSchema } from './schemas'

export const CreateLadderInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    audience: z.string().trim().max(64).nullable().optional(),
    order: z.number().int().min(0).optional(),
})
export const CreateLadderOutputSchema = RankLadderOutputSchema

export class CreateLadderFeature {
    constructor(
        readonly payload: z.infer<typeof CreateLadderInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateLadderFeatureResponse = z.infer<
    typeof CreateLadderOutputSchema
>
