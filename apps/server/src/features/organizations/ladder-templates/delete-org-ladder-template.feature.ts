import { z } from 'zod'

export const DeleteOrgLadderTemplateOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteOrgLadderTemplateFeature {
    constructor(
        readonly organizationId: string,
        readonly templateId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteOrgLadderTemplateFeatureResponse = z.infer<
    typeof DeleteOrgLadderTemplateOutputSchema
>
