import { z } from 'zod'

import { AtRiskContactSchema } from './schemas'

export const LogAtRiskContactInputSchema = z.object({
    // '' is stored as null by the handler.
    note: z.string().trim().max(500).nullable().optional(),
})

export const LogAtRiskContactOutputSchema = AtRiskContactSchema

export class LogAtRiskContactFeature {
    constructor(
        readonly payload: z.infer<typeof LogAtRiskContactInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type LogAtRiskContactFeatureResponse = z.infer<
    typeof LogAtRiskContactOutputSchema
>
