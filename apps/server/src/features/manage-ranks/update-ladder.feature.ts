import { z } from 'zod'

import { RankLadderOutputSchema } from './schemas'

export const UpdateLadderInputSchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        audience: z.string().trim().max(64).nullable().optional(),
        isActive: z.boolean().optional(),
        order: z.number().int().min(0).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one field must be provided',
    })
export const UpdateLadderOutputSchema = RankLadderOutputSchema

export class UpdateLadderFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateLadderInputSchema>,
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateLadderFeatureResponse = z.infer<
    typeof UpdateLadderOutputSchema
>
