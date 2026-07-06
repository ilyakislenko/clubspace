import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { AUTHOR_SELECT } from './create-announcement.handler'
import { announceToWorkspace } from './notify'
import { serializeAnnouncement } from './schemas'
import {
    UpdateAnnouncementFeature,
    UpdateAnnouncementFeatureResponse,
} from './update-announcement.feature'

@Feature(UpdateAnnouncementFeature)
export class UpdateAnnouncementHandler
    implements
        IFeatureHandler<
            UpdateAnnouncementFeature,
            UpdateAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UpdateAnnouncementFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.announcement.findFirst({
            where: { id: f.announcementId, workspaceId: f.workspaceId },
            select: { id: true, publishedAt: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Announcement not found' })
        }

        const p = f.payload
        const publishedAt =
            p.publish === undefined
                ? undefined
                : p.publish
                  ? (existing.publishedAt ?? new Date())
                  : null

        const updated = await this.prisma.announcement.update({
            where: { id: f.announcementId },
            data: {
                ...(p.title !== undefined ? { title: p.title } : {}),
                ...(p.body !== undefined ? { body: p.body } : {}),
                ...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
                ...(publishedAt !== undefined ? { publishedAt } : {}),
            },
            include: { author: AUTHOR_SELECT },
        })

        const serialized = serializeAnnouncement(updated)

        if (!existing.publishedAt && updated.publishedAt) {
            // Draft → published: notify (deduped on the id) and add the row to
            // open feeds live.
            await announceToWorkspace(this.notifications, updated)
            this.realtime.emitListDelta(
                f.workspaceId,
                'announcements',
                'create',
                serialized,
            )
        } else if (updated.publishedAt) {
            // Edit to an already-live announcement — patch it in open feeds.
            this.realtime.emitListDelta(
                f.workspaceId,
                'announcements',
                'update',
                serialized,
            )
        }

        return serialized
    }
}
