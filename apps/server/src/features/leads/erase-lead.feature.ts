import type { z } from 'zod'

import { LeadSchema } from './schemas'

// POST leads/:leadId/erase — «Удалить данные» (152-ФЗ ст. 21): the personal
// fields go now; the lead stays in the report without a name.
export class EraseLeadFeature {
    constructor(
        readonly workspaceId: string,
        readonly leadId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly now: Date = new Date(),
    ) {}
}
export type EraseLeadFeatureResponse = z.infer<typeof LeadSchema>
