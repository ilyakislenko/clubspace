import { z } from 'zod'

export const UnsubscribeClubMessagesInputSchema = z.object({
    // From the e-mail's «Отписаться от писем клуба» link.
    token: z.string().min(1).max(200),
})

export const UnsubscribeClubMessagesOutputSchema = z.object({
    // false = only checked (the link's confirm page), true = switched off.
    unsubscribed: z.boolean(),
})

export class UnsubscribeClubMessagesFeature {
    constructor(
        readonly payload: z.infer<typeof UnsubscribeClubMessagesInputSchema>,
        // GET only checks the link (mail scanners open every link); the POST
        // from the confirm page or the mail client's one-click writes.
        readonly apply: boolean,
    ) {}
}
export type UnsubscribeClubMessagesFeatureResponse = z.infer<
    typeof UnsubscribeClubMessagesOutputSchema
>
