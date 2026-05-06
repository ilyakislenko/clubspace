import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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

        return { status: 'deleted' as const }
    }
}
