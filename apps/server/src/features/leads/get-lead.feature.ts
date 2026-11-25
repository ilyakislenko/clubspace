import type { z } from 'zod'

import { LeadSchema } from './schemas'

export const LeadOutputSchema = LeadSchema

export class GetLeadFeature {
    constructor(
        readonly workspaceId: string,
        readonly leadId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetLeadFeatureResponse = z.infer<typeof LeadOutputSchema>
