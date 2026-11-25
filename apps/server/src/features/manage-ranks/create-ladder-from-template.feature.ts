import { z } from 'zod'

import { RankLadderOutputSchema } from './schemas'

export const CreateRankLadderFromTemplateInputSchema = z.object({
    // A federation standard of an organization this club is ACTIVE in.
    templateId: z.string().uuid(),
    // Discipline of the copy; null/omitted = club-wide.
    directionId: z.string().uuid().nullish(),
    // Default: the standard's name.
    name: z.string().trim().min(1).max(255).optional(),
})
export const CreateRankLadderFromTemplateOutputSchema = RankLadderOutputSchema

export class CreateRankLadderFromTemplateFeature {
    constructor(
        readonly payload: z.infer<typeof CreateRankLadderFromTemplateInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateRankLadderFromTemplateFeatureResponse = z.infer<
    typeof CreateRankLadderFromTemplateOutputSchema
>
