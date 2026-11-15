import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import {
    encryptPaymentSecret,
    secretHint,
} from '../../domains/payments/payment-credentials'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
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
        private readonly modules: ModuleEntitlementService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute(f: UpdatePaymentSettingsFeature) {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.modules.assertEntitled(f.workspaceId, 'ONLINE_PAYMENTS')
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
        // Member autopay is YooKassa-only and behind the global switch
        // (docs/design/2026-11-15-member-autopay.md §3.5, §10). Another
        // provider turns it off.
        if (p.autopayEnabled && p.provider !== 'YOOKASSA') {
            throw new BadRequestError({ message: 'Автоплатежи доступны только с ЮKassa' })
        }
        if (p.autopayEnabled && !environment.memberAutopay.enabled) {
            throw new BadRequestError({ message: 'Автоплатежи учеников пока недоступны' })
        }
        const autopayEnabled =
            p.provider === 'YOOKASSA' &&
            (p.autopayEnabled ?? (sameProvider ? saved?.autopayEnabled : false) ?? false)

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
            autopayEnabled,
            // A fresh confirmation clears YooKassa's last refusal.
            ...(p.autopayEnabled ? { autopayLastError: null, autopayLastErrorAt: null } : {}),
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

        // Tokens belong to one shop of one provider: turning autopay off or
        // moving to another shop stops every live agreement (SYSTEM, with
        // notices). Agreements exist only while the setting is on; the hourly
        // pass re-checks the same as a safety net.
        if (saved?.autopayEnabled) {
            const reason = !sameProvider
                ? 'клуб сменил платёжную систему'
                : shopId !== saved.shopId
                  ? 'клуб сменил магазин ЮKassa'
                  : !autopayEnabled
                    ? 'клуб отключил автоплатежи'
                    : null
            if (reason) await this.autopay.cancelForWorkspace(f.workspaceId, reason)
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
                autopayEnabled,
            },
        })

        return loadPaymentSettingsView(this.prisma, f.workspaceId)
    }
}
