import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { endOfDayMoscow } from '../../domains/billing/billing-rules'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import {
    UpdatePlatformWorkspaceModuleFeature,
    UpdatePlatformWorkspaceModuleFeatureResponse,
} from './update-platform-workspace-module.feature'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// The platform owner sets one paid module for a club: on the bill, granted
// free until a date, switched off, or back to the default. Audited with the
// previous setting. Turning a module off hides it from students at once (the
// gates read the entitlement live); staff keep what was already uploaded.
@Feature(UpdatePlatformWorkspaceModuleFeature)
export class UpdatePlatformWorkspaceModuleHandler
    implements
        IFeatureHandler<
            UpdatePlatformWorkspaceModuleFeature,
            UpdatePlatformWorkspaceModuleFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: UpdatePlatformWorkspaceModuleFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const { module, mode } = f.payload
        const where = { workspaceId: f.workspaceId, module }
        const previous = await this.prisma.workspaceModuleEntitlement.findFirst({
            where,
            select: { mode: true, compUntil: true, customPrice: true },
        })

        if (mode === 'DEFAULT') {
            await this.prisma.workspaceModuleEntitlement.deleteMany({ where })
        } else {
            const data = {
                mode,
                compUntil:
                    mode === 'COMP' && f.payload.compUntil
                        ? endOfDayMoscow(f.payload.compUntil)
                        : null,
                customPrice: mode === 'PAID' ? (f.payload.customPrice ?? null) : null,
            }
            const { count } = await this.prisma.workspaceModuleEntitlement.updateMany({
                where,
                data,
            })
            if (count === 0) {
                try {
                    await this.prisma.workspaceModuleEntitlement.create({
                        data: { ...where, ...data },
                    })
                } catch (e) {
                    // A second operator created it meanwhile: last write wins.
                    if (!isP2002(e)) throw e
                    await this.prisma.workspaceModuleEntitlement.updateMany({
                        where,
                        data,
                    })
                }
            }
        }

        await this.audit.record({
            action: 'workspace.moduleUpdate',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                module,
                from: previous ?? { mode: 'DEFAULT' },
                to: {
                    mode,
                    ...(f.payload.compUntil ? { compUntil: f.payload.compUntil } : {}),
                    ...(f.payload.customPrice !== undefined
                        ? { customPrice: f.payload.customPrice }
                        : {}),
                },
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
