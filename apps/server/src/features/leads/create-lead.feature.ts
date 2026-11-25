import { z } from 'zod'

import { LEAD_LIMITS, leadContactFields, LeadSchema, refineLeadContact } from './schemas'

// POST leads — «Добавить заявку»: someone called or walked in. Staff confirm
// the person agreed to the club keeping their contacts for the trial; the
// lead records who attested it.
export const CreateLeadInputSchema = z
    .object({
        ...leadContactFields,
        staffNote: z.string().trim().max(LEAD_LIMITS.staffNote).optional(),
        consentConfirmed: z.literal(true),
    })
    .superRefine(refineLeadContact)

export class CreateLeadFeature {
    constructor(
        readonly payload: z.infer<typeof CreateLeadInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateLeadFeatureResponse = z.infer<typeof LeadSchema>
