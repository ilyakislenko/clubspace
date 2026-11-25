import { z } from 'zod'

import { OrgLadderTemplateOutputSchema, TemplateLevelFields } from './schemas'

export const UpdateOrgLadderTemplateLevelInputSchema = z
    .object(TemplateLevelFields)
    .partial()
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdateOrgLadderTemplateLevelOutputSchema = OrgLadderTemplateOutputSchema

export class UpdateOrgLadderTemplateLevelFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrgLadderTemplateLevelInputSchema>,
        readonly organizationId: string,
        readonly templateId: string,
        readonly levelId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateOrgLadderTemplateLevelFeatureResponse = z.infer<
    typeof UpdateOrgLadderTemplateLevelOutputSchema
>
