import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    DeleteWorkspaceEventFeature,
    DeleteWorkspaceEventFeatureResponse,
} from './delete-workspace-event.feature'

@Feature(DeleteWorkspaceEventFeature)
export class DeleteWorkspaceEventHandler
    implements
        IFeatureHandler<
            DeleteWorkspaceEventFeature,
            DeleteWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        workspaceId,
        eventId,
        invokerUserId,
    }: DeleteWorkspaceEventFeature) {
        await this.prisma.workspaceEvent.deleteMany({
            where: { id: eventId, workspaceId },
        })

        await this.audit.record({
            action: 'event.delete',
            targetType: 'event',
            targetId: eventId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {},
        })

        this.realtime.emitListDelta(workspaceId, 'events', 'delete', {
            id: eventId,
        })

        return { status: 'deleted' as const }
    }
}
