import { z } from 'zod'

import { VisitAbonementSchema } from '../attendance/schemas'

// What a check-in with this code would do — shown before the member confirms
// (and picks another abonement). Writes nothing.
export const SelfCheckInPreviewInputSchema = z.object({
    code: z.string().trim().min(1).max(12),
})

export const SelfCheckInPreviewOutputSchema = z.object({
    sessionId: z.string().uuid(),
    sessionTitle: z.string(),
    startAt: z.iso.datetime(),
    alreadyCheckedIn: z.boolean(),
    // Already checked in: the abonement that visit was spent on; otherwise the
    // one a check-in would use by default. null = none can pay.
    abonement: VisitAbonementSchema.nullable(),
    // Abonements this class may be spent on, in precedence order (already
    // checked in: the used one first).
    abonementOptions: z.array(VisitAbonementSchema),
})

export class SelfCheckInPreviewFeature {
    constructor(
        readonly payload: z.infer<typeof SelfCheckInPreviewInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type SelfCheckInPreviewFeatureResponse = z.infer<
    typeof SelfCheckInPreviewOutputSchema
>
