import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { endOfDayMoscow } from '../../domains/billing/billing-rules'
import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import {
    featureFlagSelect,
    toFeatureFlags,
} from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    LockPlatformWorkspaceFeatureFeature,
    LockPlatformWorkspaceFeatureFeatureResponse,
} from './platform-feature-locks.feature'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// The platform owner pins a club's app-section switch on or off, optionally
// through a date, audited with what it was before. Videos keep the rule the
// club itself has: on only with the VIDEO module.
@Feature(LockPlatformWorkspaceFeatureFeature)
export class LockPlatformWorkspaceFeatureHandler
    implements
        IFeatureHandler<
            LockPlatformWorkspaceFeatureFeature,
            LockPlatformWorkspaceFeatureFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
        private readonly modules: ModuleEntitlementService,
    ) {}

    async execute(f: LockPlatformWorkspaceFeatureFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { feature, enabled } = f.payload
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: featureFlagSelect,
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        const until = f.payload.until ? endOfDayMoscow(f.payload.until) : null
        if (until && until <= new Date()) {
            throw new BadRequestError({
                message: 'Дата окончания уже прошла',
            })
        }
        if (feature === 'videos' && enabled) {
            await this.modules.assertEntitled(f.workspaceId, 'VIDEO')
        }

        const where = { workspaceId: f.workspaceId, feature }
        const previous = await this.prisma.workspaceFeatureLock.findFirst({
            where,
            select: { enabled: true, until: true },
        })
        const data = { enabled, until }
        const { count } = await this.prisma.workspaceFeatureLock.updateMany({
            where,
            data,
        })
        if (count === 0) {
            try {
                await this.prisma.workspaceFeatureLock.create({
                    data: { ...where, ...data },
                })
            } catch (e) {
                // A second operator locked it meanwhile: last write wins.
                if (!isP2002(e)) throw e
                await this.prisma.workspaceFeatureLock.updateMany({ where, data })
            }
        }
        await this.prisma.workspace.update({
            where: { id: f.workspaceId },
            data: { [`${feature}Enabled`]: enabled },
        })

        await this.audit.record({
            action: 'workspace.featureLock',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                feature,
                from: toFeatureFlags(workspace)[feature],
                to: enabled,
                until: f.payload.until ?? null,
                previousLock: previous
                    ? {
                          enabled: previous.enabled,
                          until: previous.until?.toISOString() ?? null,
                      }
                    : null,
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
