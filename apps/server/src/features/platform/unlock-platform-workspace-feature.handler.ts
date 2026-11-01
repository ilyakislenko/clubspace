import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { APP_FEATURE_KEYS } from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    UnlockPlatformWorkspaceFeatureFeature,
    UnlockPlatformWorkspaceFeatureFeatureResponse,
} from './platform-feature-locks.feature'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'

// The platform owner lifts a lock: the switch keeps its value and the club's
// admin controls it again. Audited with the lock that was lifted.
@Feature(UnlockPlatformWorkspaceFeatureFeature)
export class UnlockPlatformWorkspaceFeatureHandler
    implements
        IFeatureHandler<
            UnlockPlatformWorkspaceFeatureFeature,
            UnlockPlatformWorkspaceFeatureFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: UnlockPlatformWorkspaceFeatureFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        if (!(APP_FEATURE_KEYS as readonly string[]).includes(f.feature)) {
            throw new BadRequestError({ message: 'Неизвестный раздел' })
        }
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        const where = { workspaceId: f.workspaceId, feature: f.feature }
        const lock = await this.prisma.workspaceFeatureLock.findFirst({
            where,
            select: { enabled: true, until: true },
        })
        if (!lock) {
            throw new NotFoundError({ message: 'Раздел не закреплён платформой' })
        }
        await this.prisma.workspaceFeatureLock.deleteMany({ where })

        await this.audit.record({
            action: 'workspace.featureUnlock',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                feature: f.feature,
                lock: {
                    enabled: lock.enabled,
                    until: lock.until?.toISOString() ?? null,
                },
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
