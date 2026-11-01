import { z } from 'zod'

import { DirectionColorSchema, DirectionOutputSchema } from './schemas'

export const UpdateDirectionInputSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        color: DirectionColorSchema.nullish(),
        icon: z.string().trim().max(16).nullish(),
        order: z.number().int().min(0).max(10000).optional(),
        // false = archived: hidden from members and from new pick-lists; rows
        // already tagged keep their direction.
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })

export const UpdateDirectionOutputSchema = DirectionOutputSchema

export class UpdateDirectionFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateDirectionInputSchema>,
        readonly workspaceId: string,
        readonly directionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateDirectionFeatureResponse = z.infer<
    typeof UpdateDirectionOutputSchema
>
