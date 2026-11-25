import { z } from 'zod'

import { strictBoolean } from '../../../shared/utils/strict-boolean'
import { OrgLadderTemplateOutputSchema } from './schemas'

export const ListOrgLadderTemplatesInputSchema = z.object({
    includeInactive: strictBoolean().optional(),
})
export const ListOrgLadderTemplatesOutputSchema = z.object({
    data: z.array(OrgLadderTemplateOutputSchema),
})

export class ListOrgLadderTemplatesFeature {
    constructor(
        readonly payload: z.infer<typeof ListOrgLadderTemplatesInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListOrgLadderTemplatesFeatureResponse = z.infer<
    typeof ListOrgLadderTemplatesOutputSchema
>
