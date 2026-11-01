import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateDirectionFeature,
    CreateDirectionFeatureResponse,
} from './create-direction.feature'
import { DIRECTION_ADMIN_MESSAGE, serializeDirection } from './schemas'

@Feature(CreateDirectionFeature)
export class CreateDirectionHandler
    implements
        IFeatureHandler<CreateDirectionFeature, CreateDirectionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CreateDirectionFeature) {
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
        const p = f.payload
        // New directions go to the end unless an order is given.
        const order =
            p.order ??
            (await this.prisma.direction.count({
                where: { workspaceId: f.workspaceId },
            }))
        const direction = await this.prisma.direction.create({
            data: {
                workspaceId: f.workspaceId,
                name: p.name,
                color: p.color || null,
                icon: p.icon || null,
                order,
                isActive: p.isActive ?? true,
            },
        })
        await this.audit.record({
            action: 'direction.create',
            targetType: 'direction',
            targetId: direction.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { name: direction.name },
        })
        this.realtime.invalidate(f.workspaceId, ['directions'])
        return serializeDirection(direction)
    }
}
