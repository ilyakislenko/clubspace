import { z } from 'zod'

import { OrgLadderTemplateOutputSchema } from './schemas'

export const DeleteOrgLadderTemplateLevelOutputSchema = OrgLadderTemplateOutputSchema

export class DeleteOrgLadderTemplateLevelFeature {
    constructor(
        readonly organizationId: string,
        readonly templateId: string,
        readonly levelId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteOrgLadderTemplateLevelFeatureResponse = z.infer<
    typeof DeleteOrgLadderTemplateLevelOutputSchema
>
