import { decrypt, encrypt } from '../../shared/utils/encryption.util'
import type { GatewayCredentials } from './payment-gateway.types'

// The stored row (WorkspacePaymentSettings) → what the client needs. Secrets
// are decrypted only here, on the server, right before a provider call.

export type StoredPaymentSettings = {
    provider: 'YOOKASSA' | 'STRIPE'
    shopId: string | null
    secretKeyEncrypted: string
    webhookSecretEncrypted: string | null
    receiptEnabled: boolean
    vatCode: number
    paymentSubject: string
    paymentMode: string
}

export const encryptPaymentSecret = (value: string, encryptionKey: string) =>
    encrypt(value, encryptionKey)

// What the admin sees instead of the secret: its last four characters.
export const secretHint = (secret: string) => secret.slice(-4)

export const toGatewayCredentials = (
    row: StoredPaymentSettings,
    encryptionKey: string,
): GatewayCredentials => {
    const secretKey = decrypt(row.secretKeyEncrypted, encryptionKey)
    if (row.provider === 'YOOKASSA') {
        return {
            provider: 'YOOKASSA',
            shopId: row.shopId ?? '',
            secretKey,
            receipt: {
                enabled: row.receiptEnabled,
                vatCode: row.vatCode,
                paymentSubject: row.paymentSubject,
                paymentMode: row.paymentMode,
            },
        }
    }
    return { provider: 'STRIPE', secretKey }
}

export const stripeWebhookSecret = (
    row: Pick<StoredPaymentSettings, 'webhookSecretEncrypted'>,
    encryptionKey: string,
): string | null =>
    row.webhookSecretEncrypted
        ? decrypt(row.webhookSecretEncrypted, encryptionKey)
        : null
