import { z } from 'zod'

import { AutopayOfferOutputSchema } from './schemas'

// What the member will pay before the provider's page opens
// (docs/design/2026-11-15-discounts.md §3.3, ЗоЗПП ст. 10): a tariff or one of
// their event tickets, exactly one, with an optional promo code.
export const GetCheckoutQuoteQuerySchema = z
    .object({
        planId: z.string().uuid().optional(),
        registrationId: z.string().uuid().optional(),
        promoCode: z.string().max(40).optional(),
    })
    .superRefine((v, ctx) => {
        if (!v.planId === !v.registrationId) {
            ctx.addIssue({
                code: 'custom',
                path: ['planId'],
                message: 'Укажите тариф или запись на событие',
            })
        }
    })

export const CheckoutQuoteOutputSchema = z.object({
    // The tariff's / event's price.
    listPrice: z.number().int(),
    // What the checkout charges with this code (or without one).
    amount: z.number().int(),
    currency: z.string(),
    // The discount in `amount`: the family one or the code's.
    discount: z
        .object({
            name: z.string(),
            code: z.string().nullable(),
            isFamily: z.boolean(),
            // Its last club-local day (null: open-ended).
            endsOn: z.iso.date().nullable(),
        })
        .nullable(),
    // Why the code didn't change the price («Промокод не найден», «Семейная
    // скидка выгоднее — она уже учтена», …); null without a code or when it
    // applied. Every note but the family one refuses the checkout with it.
    promoCodeNote: z.string().nullable(),
    // A tariff that may renew automatically: the offer with the consent's
    // «сейчас» = `amount` (a promo code included) and «дальше» = the renewal
    // price (automatic discounts only). null for a ticket or where autopay
    // isn't offered (docs/design/2026-11-15-member-autopay.md §3.3).
    autopay: AutopayOfferOutputSchema.nullable(),
})

export class GetCheckoutQuoteFeature {
    constructor(
        readonly payload: z.infer<typeof GetCheckoutQuoteQuerySchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetCheckoutQuoteFeatureResponse = z.infer<typeof CheckoutQuoteOutputSchema>
