import {
    encryptPaymentSecret,
    secretHint,
    stripeWebhookSecret,
    toGatewayCredentials,
} from './payment-credentials'

const key = 'unit-test-encryption-key'

describe('payment credentials', () => {
    it('stores secrets encrypted and decrypts them for the client only', () => {
        const encrypted = encryptPaymentSecret('test_secret_1234', key)
        expect(encrypted).not.toContain('test_secret')
        expect(
            toGatewayCredentials(
                {
                    provider: 'YOOKASSA',
                    shopId: '123',
                    secretKeyEncrypted: encrypted,
                    webhookSecretEncrypted: null,
                    receiptEnabled: true,
                    vatCode: 4,
                    paymentSubject: 'service',
                    paymentMode: 'full_payment',
                },
                key,
            ),
        ).toEqual({
            provider: 'YOOKASSA',
            shopId: '123',
            secretKey: 'test_secret_1234',
            receipt: {
                enabled: true,
                vatCode: 4,
                paymentSubject: 'service',
                paymentMode: 'full_payment',
            },
        })
    })

    it('builds Stripe credentials and reads the webhook secret', () => {
        const row = {
            provider: 'STRIPE' as const,
            shopId: null,
            secretKeyEncrypted: encryptPaymentSecret('sk_test_abc', key),
            webhookSecretEncrypted: encryptPaymentSecret('whsec_xyz', key),
            receiptEnabled: true,
            vatCode: 1,
            paymentSubject: 'service',
            paymentMode: 'full_prepayment',
        }
        expect(toGatewayCredentials(row, key)).toEqual({
            provider: 'STRIPE',
            secretKey: 'sk_test_abc',
        })
        expect(stripeWebhookSecret(row, key)).toBe('whsec_xyz')
        expect(
            stripeWebhookSecret({ webhookSecretEncrypted: null }, key),
        ).toBeNull()
    })

    it('masks to the last four characters', () => {
        expect(secretHint('live_abcdef1234')).toBe('1234')
    })
})
