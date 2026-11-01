import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import {
    encryptPaymentSecret,
    secretHint,
} from '../../domains/payments/payment-credentials'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadPaymentSettingsView } from './payment-settings-view'
import { DEFAULT_RECEIPT } from './schemas'
import {
    UpdatePaymentSettingsFeature,
    UpdatePaymentSettingsFeatureResponse,
} from './update-payment-settings.feature'

@Feature(UpdatePaymentSettingsFeature)
export class UpdatePaymentSettingsHandler
    implements
        IFeatureHandler<
            UpdatePaymentSettingsFeature,
            UpdatePaymentSettingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdatePaymentSettingsFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const p = f.payload
        const saved = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        // Keys belong to one provider: switching needs the new provider's keys.
        const sameProvider = saved?.provider === p.provider
        if (!sameProvider && !p.secretKey) {
            throw new BadRequestError({
                message: 'Укажите секретный ключ',
            })
        }
        const shopId =
            p.provider === 'YOOKASSA'
                ? (p.shopId ?? (sameProvider ? saved?.shopId : null) ?? null)
                : null
        if (p.provider === 'YOOKASSA' && !shopId) {
            throw new BadRequestError({ message: 'Укажите shopId магазина ЮKassa' })
        }
        const keepWebhookSecret = sameProvider && !p.webhookSecret
        if (
            p.provider === 'STRIPE' &&
            !p.webhookSecret &&
            !(keepWebhookSecret && saved?.webhookSecretEncrypted)
        ) {
            throw new BadRequestError({
                message: 'Укажите секрет подписи вебхука Stripe (whsec_…)',
            })
        }

        const key = environment.encryptionKey
        const credentialsChanged =
            !sameProvider ||
            !!p.secretKey ||
            !!p.webhookSecret ||
            (p.shopId !== undefined && p.shopId !== saved?.shopId)
        const data = {
            provider: p.provider,
            shopId,
            ...(p.secretKey
                ? {
                      secretKeyEncrypted: encryptPaymentSecret(p.secretKey, key),
                      secretKeyHint: secretHint(p.secretKey),
                  }
                : {}),
            webhookSecretEncrypted:
                p.provider !== 'STRIPE'
                    ? null
                    : p.webhookSecret
                      ? encryptPaymentSecret(p.webhookSecret, key)
                      : (saved?.webhookSecretEncrypted ?? null),
            receiptEnabled:
                p.receiptEnabled ??
                saved?.receiptEnabled ??
                DEFAULT_RECEIPT.receiptEnabled,
            vatCode: p.vatCode ?? saved?.vatCode ?? DEFAULT_RECEIPT.vatCode,
            paymentSubject:
                p.paymentSubject ??
                saved?.paymentSubject ??
                DEFAULT_RECEIPT.paymentSubject,
            paymentMode:
                p.paymentMode ?? saved?.paymentMode ?? DEFAULT_RECEIPT.paymentMode,
            // New keys are unproven until the next connection check.
            ...(credentialsChanged ? { verifiedAt: null } : {}),
        }

        if (saved) {
            await this.prisma.workspacePaymentSettings.update({
                where: { workspaceId: f.workspaceId },
                data,
            })
        } else {
            // First connection: the secret key is guaranteed above.
            await this.prisma.workspacePaymentSettings.create({
                data: {
                    ...data,
                    workspaceId: f.workspaceId,
                    secretKeyEncrypted: encryptPaymentSecret(p.secretKey!, key),
                    secretKeyHint: secretHint(p.secretKey!),
                },
            })
        }

        await this.audit.record({
            action: 'workspace.updatePaymentSettings',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            // Never the secrets — only which ones were replaced.
            metadata: {
                provider: p.provider,
                previousProvider: saved?.provider ?? null,
                secretKeyChanged: !!p.secretKey,
                webhookSecretChanged: !!p.webhookSecret,
                receiptEnabled: data.receiptEnabled,
                vatCode: data.vatCode,
                paymentSubject: data.paymentSubject,
                paymentMode: data.paymentMode,
            },
        })

        return loadPaymentSettingsView(this.prisma, f.workspaceId)
    }
}
