import { z } from 'zod'

import { OrgLadderTemplateOutputSchema, TemplateLevelFields } from './schemas'

export const CreateOrgLadderTemplateLevelInputSchema = z.object(TemplateLevelFields)
// The whole template, with the bumped version.
export const CreateOrgLadderTemplateLevelOutputSchema = OrgLadderTemplateOutputSchema

export class CreateOrgLadderTemplateLevelFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrgLadderTemplateLevelInputSchema>,
        readonly organizationId: string,
        readonly templateId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateOrgLadderTemplateLevelFeatureResponse = z.infer<
    typeof CreateOrgLadderTemplateLevelOutputSchema
>
