import { z } from 'zod'

import { ListAuditEventsFeatureOutputSchema } from '../list-audit-events/list-audit-events.feature'

// «Настройки → История изменений» of the org console: the org's own actions
// and the clubs' decisions about it (a club's decision is labelled with the
// club, never its owner's name or e-mail).
export const ListOrgAuditEventsInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

export const ListOrgAuditEventsOutputSchema = ListAuditEventsFeatureOutputSchema

export class ListOrgAuditEventsFeature {
    constructor(
        readonly payload: z.infer<typeof ListOrgAuditEventsInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListOrgAuditEventsFeatureResponse = z.infer<typeof ListOrgAuditEventsOutputSchema>
