import { z } from 'zod'

import { TelegramStatusOutputSchema } from './schemas'

// «Telegram» in the app's notification settings: the signed-in user's own chat
// with the member-facing bot. User-level, no club scope.

export class GetMyTelegramFeature {
    constructor(readonly userId: string) {}
}
export type GetMyTelegramFeatureResponse = z.infer<typeof TelegramStatusOutputSchema>

export const TelegramLinkOutputSchema = z.object({
    // https://t.me/<bot>?start=<one-time token>; open it, press «Start».
    url: z.string(),
    expiresAt: z.iso.datetime(),
})
export class CreateTelegramLinkFeature {
    constructor(readonly userId: string) {}
}
export type CreateTelegramLinkFeatureResponse = z.infer<typeof TelegramLinkOutputSchema>

export const UpdateMyTelegramInputSchema = z.object({
    enabled: z.boolean(),
})
export class UpdateMyTelegramFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<typeof UpdateMyTelegramInputSchema>,
    ) {}
}
export type UpdateMyTelegramFeatureResponse = z.infer<typeof TelegramStatusOutputSchema>

export class UnlinkMyTelegramFeature {
    constructor(readonly userId: string) {}
}
export type UnlinkMyTelegramFeatureResponse = z.infer<typeof TelegramStatusOutputSchema>

// Telegram's update, as far as it is read: a text message in a private chat.
// Everything else in the body is ignored.
export const TelegramUpdateSchema = z.object({
    message: z
        .object({
            chat: z.object({
                id: z.union([z.number().int(), z.string().regex(/^-?\d{1,20}$/)]),
                type: z.string(),
            }),
            text: z.string().max(4096).optional(),
        })
        .optional(),
})

export const TelegramWebhookOutputSchema = z.object({ ok: z.literal(true) })
export class HandleTelegramWebhookFeature {
    constructor(
        // X-Telegram-Bot-Api-Secret-Token
        readonly secretToken: string | undefined,
        readonly update: unknown,
    ) {}
}
export type HandleTelegramWebhookFeatureResponse = z.infer<
    typeof TelegramWebhookOutputSchema
>
