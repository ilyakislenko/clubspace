import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'

// Fan a published announcement out to the workspace as a push notification
// (once per announcement, author excluded). The live feed update is handled
// separately by the caller via a realtime list delta (see the handlers).
export const announceToWorkspace = async (
    notifications: NotificationProducerService,
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
}
