import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeletePaymentSettingsFeature,
    DeletePaymentSettingsFeatureResponse,
} from './delete-payment-settings.feature'
import { loadPaymentSettingsView } from './payment-settings-view'

// Disconnects the provider: the keys are erased, members stop seeing «Оплатить
// онлайн». Past payments stay; refunding them needs the keys again.
@Feature(DeletePaymentSettingsFeature)
export class DeletePaymentSettingsHandler
    implements
        IFeatureHandler<
            DeletePaymentSettingsFeature,
            DeletePaymentSettingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeletePaymentSettingsFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const removed = await this.prisma.workspacePaymentSettings.deleteMany({
            where: { workspaceId: f.workspaceId },
        })
        if (removed.count === 0) {
            throw new NotFoundError({ message: 'Онлайн-оплата не подключена' })
        }
        await this.audit.record({
            action: 'workspace.updatePaymentSettings',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { disconnected: true },
        })
        return loadPaymentSettingsView(this.prisma, f.workspaceId)
    }
}
