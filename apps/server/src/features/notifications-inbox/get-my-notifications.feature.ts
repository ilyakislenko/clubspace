import { z } from 'zod'

export const GetMyNotificationsFeatureInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

const NotificationItemSchema = z.object({
    id: z.string().uuid(),
    topic: z.string(),
    message: z.string(),
    link: z.string().nullable(),
    type: z.enum(['EMAIL', 'PUSH', 'TELEGRAM']),
    seen: z.boolean(),
    metadata: z.record(z.string(), z.any()).nullable(),
    sentAt: z.string().optional(),
    createdAt: z.string(),
})

export const GetMyNotificationsFeatureOutputSchema = z.object({
    meta: z.object({
        curPage: z.number().int(),
        perPage: z.number().int(),
        total: z.number().int(),
    }),
    data: z.array(NotificationItemSchema),
})

export class GetMyNotificationsFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<typeof GetMyNotificationsFeatureInputSchema>,
    ) {}
}

export type GetMyNotificationsFeatureResponse = z.infer<
    typeof GetMyNotificationsFeatureOutputSchema
>
