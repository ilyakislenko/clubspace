import { z } from 'zod'

import { VisitAbonementSchema } from '../attendance/schemas'

export const SelfCheckInInputSchema = z.object({
    code: z.string().trim().min(1).max(12),
    // The abonement to spend this visit on (default = the visit precedence's
    // first; the preview lists the choices). Must be eligible for the class.
    subscriptionId: z.string().uuid().optional(),
})

export const SelfCheckInOutputSchema = z.object({
    sessionId: z.string().uuid(),
    sessionTitle: z.string(),
    startAt: z.iso.datetime(),
    // false when the member was already checked in (a repeat scan is a no-op).
    checkedIn: z.boolean(),
    // Classes left on the abonement this visit was spent on (0 when only a
    // used-up pack covers the class; null = time-based or none).
    classesRemaining: z.number().int().nullable(),
    // The abonement this visit is attributed to (null = none could pay).
    abonement: VisitAbonementSchema.nullable(),
})

export class SelfCheckInFeature {
    constructor(
        readonly payload: z.infer<typeof SelfCheckInInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type SelfCheckInFeatureResponse = z.infer<typeof SelfCheckInOutputSchema>
