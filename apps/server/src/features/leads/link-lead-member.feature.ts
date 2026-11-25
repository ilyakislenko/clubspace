import { z } from 'zod'

import { LeadSchema } from './schemas'

// POST leads/:leadId/link — the lead became this student (adult or child).
// «Купил» then follows from their paid abonement.
export const LinkLeadMemberInputSchema = z.object({
    userId: z.string().uuid(),
})

export class LinkLeadMemberFeature {
    constructor(
        readonly payload: z.infer<typeof LinkLeadMemberInputSchema>,
        readonly workspaceId: string,
        readonly leadId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly now: Date = new Date(),
    ) {}
}
export type LinkLeadMemberFeatureResponse = z.infer<typeof LeadSchema>
