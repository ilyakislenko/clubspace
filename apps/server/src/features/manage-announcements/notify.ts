import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'

// Fan a published announcement out to the workspace (once per announcement,
// author excluded) as a push notification, and nudge every connected member's
// feed to refresh live. Shared by the create + update handlers.
export const announceToWorkspace = async (
    notifications: NotificationProducerService,
    realtime: RealtimeEmitter,
    a: {
        id: string
        workspaceId: string
        title: string
        body: string
        authorId: string
    },
): Promise<void> => {
    await notifications.notifyWorkspace({
        workspaceId: a.workspaceId,
        kind: 'announcement.published',
        refId: a.id,
        topic: a.title,
        message: a.body.length > 200 ? `${a.body.slice(0, 200)}…` : a.body,
        metadata: { announcementId: a.id },
        excludeUserId: a.authorId,
        category: 'announcementsEnabled',
    })
    realtime.invalidate(a.workspaceId, ['announcements'])
}
