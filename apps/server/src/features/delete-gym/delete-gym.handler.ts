import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    DeleteGymFeature,
    DeleteGymFeatureResponse,
} from './delete-gym.feature'

@Feature(DeleteGymFeature)
export class DeleteGymHandler
    implements IFeatureHandler<DeleteGymFeature, DeleteGymFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({ workspaceId, gymId, invokerUserId }: DeleteGymFeature) {
        const gym = await this.prisma.gym.findFirst({
            where: { id: gymId, workspaceId },
            select: { id: true, name: true, _count: { select: { groups: true } } },
        })

        if (!gym) {
            throw new NotFoundError({ message: 'Зал не найден' })
        }

        const orphanedGroupCount = gym._count.groups

        // SetNull on the schema cascades — groups stay alive without a gym.
        await this.prisma.gym.delete({ where: { id: gymId } })

        await this.audit.record({
            action: 'gym.delete',
            targetType: 'gym',
            targetId: gymId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                name: gym.name,
                orphanedGroupCount,
            },
        })

        this.realtime.emitListDelta(workspaceId, 'gyms', 'delete', {
            id: gymId,
        })

        return { status: 'deleted' as const, orphanedGroupCount }
    }
}
