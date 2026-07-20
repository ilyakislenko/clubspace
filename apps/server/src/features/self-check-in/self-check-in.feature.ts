import { z } from 'zod'

export const SelfCheckInInputSchema = z.object({
    code: z.string().trim().min(1).max(12),
})

export const SelfCheckInOutputSchema = z.object({
    sessionId: z.string().uuid(),
    sessionTitle: z.string(),
    startAt: z.iso.datetime(),
    // false when the member was already checked in (a repeat scan is a no-op).
    checkedIn: z.boolean(),
    // Remaining classes after this check-in (null = no class-pack / time plan).
    classesRemaining: z.number().int().nullable(),
})

export class SelfCheckInFeature {
    constructor(
        readonly payload: z.infer<typeof SelfCheckInInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type SelfCheckInFeatureResponse = z.infer<typeof SelfCheckInOutputSchema>
