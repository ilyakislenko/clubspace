import { z } from 'zod'

import {
    SubscriptionFreezeOutputSchema,
    SubscriptionOutputSchema,
} from '../member-subscriptions/schemas'
import {
    FreezeRequestWindowSchema,
    SubscriptionFreezeRequestOutputSchema,
} from '../subscription-freeze-requests/schemas'

export const GetMySubscriptionOutputSchema = z.object({
    current: SubscriptionOutputSchema.nullable(),
    history: z.array(SubscriptionOutputSchema),
    // The effective access window (mirrors WorkspaceMember.accessUntil). A
    // manual grant can extend access beyond any abonement, so this is the
    // source of truth for "до какого числа есть доступ".
    accessUntil: z.iso.datetime().nullable(),
    // The running or upcoming freeze of `current` (null when there is none).
    freeze: SubscriptionFreezeOutputSchema.nullable(),
    // The pending request of `current`, or one declined in the last week.
    freezeRequest: SubscriptionFreezeRequestOutputSchema.nullable(),
    // The start dates the member may ask a freeze for; null when asking is not
    // possible now (open freeze, pending request, abonement not freezable).
    freezeRequestWindow: FreezeRequestWindowSchema.nullable(),
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
