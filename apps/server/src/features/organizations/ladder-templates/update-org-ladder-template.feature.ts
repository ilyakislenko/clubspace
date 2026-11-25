import { z } from 'zod'

import { OrgLadderTemplateOutputSchema } from './schemas'

export const UpdateOrgLadderTemplateInputSchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        audience: z.string().trim().max(64).nullable().optional(),
        // false hides it from clubs' «Стандарты федерации»; copies stay.
        isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdateOrgLadderTemplateOutputSchema = OrgLadderTemplateOutputSchema

export class UpdateOrgLadderTemplateFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrgLadderTemplateInputSchema>,
        readonly organizationId: string,
        readonly templateId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateOrgLadderTemplateFeatureResponse = z.infer<
    typeof UpdateOrgLadderTemplateOutputSchema
>
