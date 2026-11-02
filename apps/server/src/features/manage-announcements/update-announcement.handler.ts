import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { announceToWorkspace, isTargeted, showInOpenFeeds } from './notify'
import { ANNOUNCEMENT_INCLUDE, serializeAnnouncement } from './schemas'
import {
    checkAnnouncementTarget,
    storedTargetDirectionIds,
    storedTargetSelect,
    uniqueIds,
} from './target'
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
            select: { id: true, publishedAt: true, ...storedTargetSelect },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Объявление не найдено' })
        }

        const p = f.payload
        // A new target replaces the old one whole: direction and groups.
        const retarget = p.directionId !== undefined || p.groupIds !== undefined
        const directionId =
            p.directionId !== undefined
                ? (p.directionId ?? null)
                : existing.directionId
        const groupIds =
            uniqueIds(p.groupIds) ??
            existing.groups.flatMap((g) => (g.groupId ? [g.groupId] : []))
        // The current target and, on a move, the new one must both be the
        // caller's to manage.
        await this.rbac.assertCanManageDirection(
            ctx,
            ...storedTargetDirectionIds(existing),
            ...(retarget
                ? await checkAnnouncementTarget(this.prisma, f.workspaceId, {
                      directionId,
                      groupIds,
                  })
                : []),
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
                ...(retarget
                    ? {
                          directionId,
                          groups: {
                              deleteMany: {},
                              create: groupIds.map((groupId) => ({ groupId })),
                          },
                      }
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
        // edit, a leak for a targeted one (or one just moved between targets)
        // — those make feeds refetch their own filtered list instead.
        const targeted = isTargeted(existing) || isTargeted(updated)

        if (!wasLive && isLive) {
            // Newly live (draft/scheduled → now): notify (deduped on the id) and
            // add the row to open feeds live.
            await announceToWorkspace(this.notifications, updated)
            showInOpenFeeds(this.realtime, f.workspaceId, serialized, targeted)
        } else if (isLive && targeted) {
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
