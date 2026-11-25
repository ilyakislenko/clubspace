import { z } from 'zod'

import { OrgLadderTemplateOutputSchema, TemplateLevelFields } from './schemas'

export const CreateOrgLadderTemplateInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    audience: z.string().trim().max(64).nullable().optional(),
    // The rungs at once (each `order` unique), or none to add them later.
    levels: z.array(z.object(TemplateLevelFields)).max(100).optional(),
})
export const CreateOrgLadderTemplateOutputSchema = OrgLadderTemplateOutputSchema

export class CreateOrgLadderTemplateFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrgLadderTemplateInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateOrgLadderTemplateFeatureResponse = z.infer<
    typeof CreateOrgLadderTemplateOutputSchema
>
