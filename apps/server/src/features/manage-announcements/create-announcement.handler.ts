import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateAnnouncementFeature,
    CreateAnnouncementFeatureResponse,
} from './create-announcement.feature'
import { announceToWorkspace, showInOpenFeeds } from './notify'
import { ANNOUNCEMENT_INCLUDE, serializeAnnouncement } from './schemas'

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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            f.payload.directionId,
        )
        await this.rbac.assertCanManageDirection(
            ctx,
            f.payload.directionId ?? null,
        )
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
                audience: f.payload.audience ?? 'ALL',
                directionId: f.payload.directionId ?? null,
                publishedAt,
            },
            include: ANNOUNCEMENT_INCLUDE,
        })

        const serialized = serializeAnnouncement(created)

        // Only fan out + feed-delta when it's actually live now. A scheduled
        // (future) announcement stays hidden until its time — the member feed
        // filters on publishedAt <= now, so it appears then; notifying members
        // at go-live would need the scheduler (follow-up).
        if (created.publishedAt && created.publishedAt <= new Date()) {
            await announceToWorkspace(this.notifications, created)
            showInOpenFeeds(this.realtime, f.workspaceId, serialized)
        }

        return serialized
    }
}
