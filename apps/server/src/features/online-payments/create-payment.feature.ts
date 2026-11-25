import { z } from 'zod'

import { MyPaymentOutputSchema } from './schemas'

// A promo code the member typed: the price is the quote's (get-checkout-quote)
// or the purchase is refused, never charged at another price.
export const PromoCodeInputSchema = z.string().max(40).optional()

export const CreatePaymentInputSchema = z
    .object({
        planId: z.string().uuid(),
        promoCode: PromoCodeInputSchema,
        // The member ticked «Продлевать автоматически» (never pre-ticked).
        autopay: z.boolean().default(false),
        // The consent version the screen showed (the offer's consentVersion);
        // required with autopay.
        autopayConsentVersion: z.string().max(64).optional(),
        // The renewal amount the consent showed («дальше Y», the offer's
        // renewalAmount); required with autopay. 409 when it changed since.
        autopayRenewalAmount: z.number().int().min(0).max(100_000_000).optional(),
    })
    .superRefine((v, ctx) => {
        if (v.autopay && !v.autopayConsentVersion) {
            ctx.addIssue({
                code: 'custom',
                path: ['autopayConsentVersion'],
                message: 'Не указана версия условий автоплатежа',
            })
        }
        if (v.autopay && v.autopayRenewalAmount === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['autopayRenewalAmount'],
                message: 'Не указана сумма продления',
            })
        }
    })
export const CreatePaymentOutputSchema = z.object({
    payment: MyPaymentOutputSchema,
    // The provider's page; the app opens it in the browser.
    confirmationUrl: z.string(),
})

export class CreatePaymentFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePaymentInputSchema>,
        readonly workspaceId: string,
        // The holder: who gets the abonement (the child under X-Act-As).
        readonly userId: string,
        // Who pressed «Оплатить» (the guardian under X-Act-As): the payer.
        readonly actorUserId: string,
    ) {}
}
export type CreatePaymentFeatureResponse = z.infer<
    typeof CreatePaymentOutputSchema
>
