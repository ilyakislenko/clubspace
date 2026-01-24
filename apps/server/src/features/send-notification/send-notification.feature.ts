import { z } from 'zod'
import { NotificationTypeEnum } from '../../infrastructure/prisma'

export const SendNotificationFeatureInputSchema = z.object({
    userId: z.string(),
    topic: z.string(),
    message: z.string().or(
        z.object({
            htmlTemplateKey: z.string(),
            data: z.record(
                z.string(),
                z.string().or(z.number()).or(z.boolean()),
            ),
        }),
    ),
    types: z.array(z.enum(NotificationTypeEnum)),
    link: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    forced: z.boolean().optional(),
})

export const SendNotificationFeatureOutputSchema = z.object({
    success: z.boolean(),
})

export class SendNotificationFeature {
    constructor(
        readonly payload: z.infer<typeof SendNotificationFeatureInputSchema>,
    ) {}
}

export type SendNotificationFeatureResponse = z.infer<
    typeof SendNotificationFeatureOutputSchema
>
