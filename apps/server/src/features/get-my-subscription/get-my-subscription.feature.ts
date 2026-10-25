import { z } from 'zod'

import {
    SubscriptionFreezeOutputSchema,
    SubscriptionOutputSchema,
} from '../member-subscriptions/schemas'

export const GetMySubscriptionOutputSchema = z.object({
    current: SubscriptionOutputSchema.nullable(),
    history: z.array(SubscriptionOutputSchema),
    // The effective access window (mirrors WorkspaceMember.accessUntil). A
    // manual grant can extend access beyond any abonement, so this is the
    // source of truth for "до какого числа есть доступ".
    accessUntil: z.iso.datetime().nullable(),
    // The running or upcoming freeze of `current` (null when there is none).
    freeze: SubscriptionFreezeOutputSchema.nullable(),
    // The primary coach of the member's group, for «who do I call about my
    // abonement». Null for the owner, a member without a group, or a nameless coach.
    coach: z
        .object({ name: z.string(), phone: z.string().nullable() })
        .nullable(),
})

export class GetMySubscriptionFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMySubscriptionFeatureResponse = z.infer<
    typeof GetMySubscriptionOutputSchema
>
