import { z } from 'zod'

import { DirectionColorSchema, DirectionOutputSchema } from './schemas'

export const CreateDirectionInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    color: DirectionColorSchema.nullish(),
    icon: z.string().trim().max(16).nullish(),
    order: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
})

export const CreateDirectionOutputSchema = DirectionOutputSchema

export class CreateDirectionFeature {
    constructor(
        readonly payload: z.infer<typeof CreateDirectionInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateDirectionFeatureResponse = z.infer<
    typeof CreateDirectionOutputSchema
>
