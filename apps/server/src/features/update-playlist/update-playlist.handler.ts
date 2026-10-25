import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { PlaylistService } from '../../domains/playlist/services/playlist.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    UpdatePlaylistFeature,
    UpdatePlaylistFeatureResponse,
} from './update-playlist.feature'

// A course is visible to members once its publish date has arrived
// (publishedAt <= now). null (draft) or a future date (scheduled) stays hidden
// — mirrors buildCourseVisibilityClauses.
const isVisible = (publishedAt: Date | string | null, now: number): boolean => {
    if (publishedAt == null) return false
    const at =
        publishedAt instanceof Date
            ? publishedAt.getTime()
            : new Date(publishedAt).getTime()
    return at <= now
}

@Feature(UpdatePlaylistFeature)
export class UpdatePlaylistHandler
    implements
        IFeatureHandler<UpdatePlaylistFeature, UpdatePlaylistFeatureResponse>
{
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute({
        payload,
        workspaceId,
        playlistId,
        invokerUserId,
    }: UpdatePlaylistFeature) {
        // Snapshot visibility before the update so we can detect the moment a
        // course becomes visible to members (draft/scheduled -> published now).
        const before = await this.prisma.course.findFirst({
            where: { id: playlistId, workspaceId },
            select: { publishedAt: true },
        })

        const result = await this.playlistService.updatePlaylist({
            workspaceId,
            playlistId,
            data: payload,
        })

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: playlistId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { fields: Object.keys(payload) },
        })

        // Publishing (setting publishedAt) and edits to a visible course's card
        // both flow through here — refetch every open course list so members
        // see the change without reopening the screen.
        this.realtime.invalidate(workspaceId, ['courses'])

        // Fan a "new course" push to members the first time a course becomes
        // visible. Claim-guarded by course id (see notifyWorkspace), so an edit
        // to an already-published course — or a later unpublish/republish —
        // never re-notifies. Scheduled publishes that go live purely by the
        // clock (no update) aren't covered here; that would need a scheduler.
        const now = Date.now()
        const becameVisible =
            !isVisible(before?.publishedAt ?? null, now) &&
            isVisible(result.publishedAt, now)
        if (becameVisible) {
            await this.notifications.notifyWorkspace({
                workspaceId,
                kind: 'course.published',
                refId: result.id,
                topic: result.title,
                message: `Новый курс: ${result.title}`,
                metadata: { courseId: result.id, title: result.title },
                excludeUserId: invokerUserId,
                category: 'newVideosEnabled',
                feature: 'videos',
            })
        }

        return result
    }
}
