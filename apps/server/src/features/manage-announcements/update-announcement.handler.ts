import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { announceToWorkspace, showInOpenFeeds } from './notify'
import { ANNOUNCEMENT_INCLUDE, serializeAnnouncement } from './schemas'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.announcement.findFirst({
            where: { id: f.announcementId, workspaceId: f.workspaceId },
            select: { id: true, publishedAt: true, directionId: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Объявление не найдено' })
        }

        const p = f.payload
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            p.directionId,
        )
        await this.rbac.assertCanManageDirection(
            ctx,
            existing.directionId,
            p.directionId,
        )
        // publishAt (explicit time) wins; else the publish flag (keep existing
        // time if already set, else now); else leave untouched.
        const publishedAt =
            p.publishAt !== undefined
                ? new Date(p.publishAt)
                : p.publish === undefined
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
                ...(p.audience !== undefined ? { audience: p.audience } : {}),
                ...(p.directionId !== undefined
                    ? { directionId: p.directionId }
                    : {}),
                ...(publishedAt !== undefined ? { publishedAt } : {}),
            },
            include: ANNOUNCEMENT_INCLUDE,
        })

        const serialized = serializeAnnouncement(updated)

        const now = new Date()
        const wasLive =
            existing.publishedAt != null && existing.publishedAt <= now
        const isLive = updated.publishedAt != null && updated.publishedAt <= now
        // A workspace-wide delta reaches every open feed: fine for a club-wide
        // edit, a leak for a direction one (or one just moved between scopes)
        // — those make feeds refetch their own filtered list instead.
        const directionScoped =
            existing.directionId != null || updated.directionId != null

        if (!wasLive && isLive) {
            // Newly live (draft/scheduled → now): notify (deduped on the id) and
            // add the row to open feeds live.
            await announceToWorkspace(this.notifications, updated)
            showInOpenFeeds(this.realtime, f.workspaceId, serialized)
        } else if (isLive && directionScoped) {
            this.realtime.invalidate(f.workspaceId, ['announcements'])
        } else if (isLive) {
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
