import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { toGatewayCredentials } from '../../domains/payments/payment-credentials'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CheckPaymentConnectionFeature,
    CheckPaymentConnectionFeatureResponse,
} from './check-payment-connection.feature'

// «Проверить подключение»: one cheap authenticated read at the provider
// (YooKassa GET /v3/me, Stripe GET /v1/balance) with the saved keys. A refusal
// is an answer, not an error — the admin sees why.
@Feature(CheckPaymentConnectionFeature)
export class CheckPaymentConnectionHandler
    implements
        IFeatureHandler<
            CheckPaymentConnectionFeature,
            CheckPaymentConnectionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly gateway: PaymentGatewayClient,
        private readonly modules: ModuleEntitlementService,
    ) {}

    async execute(
        f: CheckPaymentConnectionFeature,
    ): Promise<CheckPaymentConnectionFeatureResponse> {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.modules.assertEntitled(f.workspaceId, 'ONLINE_PAYMENTS')
        const row = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        if (!row) {
            throw new NotFoundError({ message: 'Онлайн-оплата не подключена' })
        }
        const creds = toGatewayCredentials(row, environment.encryptionKey)
        try {
            const info = await this.gateway.checkConnection(creds)
            const verifiedAt = new Date()
            await this.prisma.workspacePaymentSettings.update({
                where: { workspaceId: f.workspaceId },
                data: { verifiedAt },
            })
            return {
                ok: true,
                testMode: info.testMode,
                accountId: info.accountId,
                message: info.testMode
                    ? 'Подключение работает (тестовый режим — деньги не списываются)'
                    : 'Подключение работает',
                verifiedAt: verifiedAt.toISOString(),
            }
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            const reason =
                err.status === 401 || err.status === 403
                    ? 'ключи не подходят'
                    : err.status === null
                      ? 'платёжная система не отвечает'
                      : (err.providerMessage ?? `ошибка ${err.status}`)
            return {
                ok: false,
                testMode: false,
                accountId: null,
                message: `Не удалось подключиться: ${reason}`,
                verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
            }
        }
    }
}
