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
        // publishAt (a specific, possibly-future time) wins over the publish
        // flag; else publish→now, else draft.
        const publishedAt = f.payload.publishAt
            ? new Date(f.payload.publishAt)
            : f.payload.publish
              ? new Date()
              : null

        const created = await this.prisma.announcement.create({
            data: {
                workspaceId: f.workspaceId,
                authorId: f.invokerUserId,
                title: f.payload.title,
                body: f.payload.body,
                pinned: f.payload.pinned ?? false,
                publishedAt,
            },
            include: { author: AUTHOR_SELECT },
        })

        const serialized = serializeAnnouncement(created)

        // Only fan out + feed-delta when it's actually live now. A scheduled
        // (future) announcement stays hidden until its time — the member feed
        // filters on publishedAt <= now, so it appears then; notifying members
        // at go-live would need the scheduler (follow-up).
        if (created.publishedAt && created.publishedAt <= new Date()) {
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
