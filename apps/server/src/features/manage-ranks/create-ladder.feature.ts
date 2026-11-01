import { z } from 'zod'

import { RankLadderOutputSchema } from './schemas'

export const CreateLadderInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    audience: z.string().trim().max(64).nullable().optional(),
    order: z.number().int().min(0).optional(),
    // Discipline of the ladder (БЖЖ belts, тайский бокс…); null = club-wide.
    directionId: z.string().uuid().nullish(),
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
