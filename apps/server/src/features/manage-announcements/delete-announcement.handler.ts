import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteAnnouncementFeature,
    DeleteAnnouncementFeatureResponse,
} from './delete-announcement.feature'

@Feature(DeleteAnnouncementFeature)
export class DeleteAnnouncementHandler
    implements
        IFeatureHandler<
            DeleteAnnouncementFeature,
            DeleteAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeleteAnnouncementFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.announcement.findFirst({
            where: { id: f.announcementId, workspaceId: f.workspaceId },
            select: { id: true, directionId: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Объявление не найдено' })
        }
        await this.rbac.assertCanManageDirection(ctx, existing.directionId)
        await this.prisma.announcement.delete({ where: { id: existing.id } })
        // Drop it from every open feed live.
        this.realtime.emitListDelta(f.workspaceId, 'announcements', 'delete', {
            id: existing.id,
        })
        return { status: 'deleted' as const }
    }
}
