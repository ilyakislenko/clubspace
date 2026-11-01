import { z } from 'zod'

import {
    PAYMENT_MODES,
    PAYMENT_SUBJECTS,
    PaymentProviderSchema,
    PaymentSettingsOutputSchema,
} from './schemas'

// Secrets are write-only: omitted = keep the saved one (the admin edits the
// receipt settings without re-entering keys). Required on first connection and
// when the provider changes — checked in the handler, which sees the saved row.
export const UpdatePaymentSettingsInputSchema = z
    .object({
        provider: PaymentProviderSchema,
        // YooKassa shopId — digits.
        shopId: z
            .string()
            .trim()
            .regex(/^\d{1,20}$/, 'shopId состоит из цифр')
            .optional(),
        secretKey: z.string().trim().min(8).max(255).optional(),
        // Stripe webhook signing secret.
        webhookSecret: z.string().trim().min(8).max(255).optional(),
        receiptEnabled: z.boolean().optional(),
        // YooKassa vat_code: 1 без НДС, 2 0%, 3 10%, 4 20%, 5 10/110,
        // 6 20/120, 7 5%, 8 7%, 9 5/105, 10 7/107, 11 22%, 12 22/122.
        vatCode: z.number().int().min(1).max(12).optional(),
        paymentSubject: z.enum(PAYMENT_SUBJECTS).optional(),
        paymentMode: z.enum(PAYMENT_MODES).optional(),
    })
    .superRefine((v, ctx) => {
        if (v.provider === 'YOOKASSA' && v.secretKey && !/^(live|test)_/.test(v.secretKey)) {
            ctx.addIssue({
                code: 'custom',
                path: ['secretKey'],
                message: 'Секретный ключ ЮKassa начинается с live_ или test_',
            })
        }
        if (v.provider === 'STRIPE' && v.secretKey && !/^(sk|rk)_(live|test)_/.test(v.secretKey)) {
            ctx.addIssue({
                code: 'custom',
                path: ['secretKey'],
                message: 'Секретный ключ Stripe начинается с sk_live_ или sk_test_',
            })
        }
        if (v.webhookSecret && !v.webhookSecret.startsWith('whsec_')) {
            ctx.addIssue({
                code: 'custom',
                path: ['webhookSecret'],
                message: 'Секрет подписи вебхука Stripe начинается с whsec_',
            })
        }
    })
export const UpdatePaymentSettingsOutputSchema = PaymentSettingsOutputSchema

export class UpdatePaymentSettingsFeature {
    constructor(
        readonly payload: z.infer<typeof UpdatePaymentSettingsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdatePaymentSettingsFeatureResponse = z.infer<
    typeof UpdatePaymentSettingsOutputSchema
>
