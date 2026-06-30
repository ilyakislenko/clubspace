import { z } from 'zod'

export const MarkNotificationsSeenFeatureInputSchema = z.object({
    // Mark specific notifications seen, or omit to mark every unseen one for
    // the current user (e.g. on opening the inbox).
    ids: z.array(z.string().uuid()).optional(),
})

export const MarkNotificationsSeenFeatureOutputSchema = z.object({
    updated: z.number().int(),
})

export class MarkNotificationsSeenFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<
            typeof MarkNotificationsSeenFeatureInputSchema
        >,
    ) {}
}

export type MarkNotificationsSeenFeatureResponse = z.infer<
    typeof MarkNotificationsSeenFeatureOutputSchema
>
