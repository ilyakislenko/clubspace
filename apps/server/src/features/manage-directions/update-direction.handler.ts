import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { DIRECTION_ADMIN_MESSAGE, serializeDirection } from './schemas'
import {
    UpdateDirectionFeature,
    UpdateDirectionFeatureResponse,
} from './update-direction.feature'

@Feature(UpdateDirectionFeature)
export class UpdateDirectionHandler
    implements
        IFeatureHandler<UpdateDirectionFeature, UpdateDirectionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UpdateDirectionFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            DIRECTION_ADMIN_MESSAGE,
        )
        const existing = await this.prisma.direction.findFirst({
            where: { id: f.directionId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Направление не найдено' })
        }
        const p = f.payload
        const updated = await this.prisma.direction.update({
            where: { id: existing.id },
            data: {
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.color !== undefined ? { color: p.color || null } : {}),
                ...(p.icon !== undefined ? { icon: p.icon || null } : {}),
                ...(p.order !== undefined ? { order: p.order } : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
            },
            include: { _count: { select: { groups: true } } },
        })
        await this.audit.record({
            action: 'direction.update',
            targetType: 'direction',
            targetId: updated.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { fields: Object.keys(p) },
        })
        this.realtime.invalidate(f.workspaceId, ['directions'])
        return serializeDirection(updated)
    }
}
