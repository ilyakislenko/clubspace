import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateAnnouncementFeature,
    CreateAnnouncementFeatureResponse,
} from './create-announcement.feature'
import { announceToWorkspace } from './notify'
import { serializeAnnouncement } from './schemas'

export const AUTHOR_SELECT = {
    select: { firstname: true, lastname: true, email: true },
} as const

@Feature(CreateAnnouncementFeature)
export class CreateAnnouncementHandler
    implements
        IFeatureHandler<
            CreateAnnouncementFeature,
            CreateAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CreateAnnouncementFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const created = await this.prisma.announcement.create({
            data: {
                workspaceId: f.workspaceId,
                authorId: f.invokerUserId,
                title: f.payload.title,
                body: f.payload.body,
                pinned: f.payload.pinned ?? false,
                publishedAt: f.payload.publish ? new Date() : null,
            },
            include: { author: AUTHOR_SELECT },
        })

        const serialized = serializeAnnouncement(created)

        // Notify members if it was published straight away (not a draft), and
        // push the new row into every open feed as a live delta.
        if (created.publishedAt) {
            await announceToWorkspace(this.notifications, created)
            this.realtime.emitListDelta(
                f.workspaceId,
                'announcements',
                'create',
                serialized,
            )
        }

        return serialized
    }
}
