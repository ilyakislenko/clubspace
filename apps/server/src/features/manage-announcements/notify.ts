import { memberOfDirectionWhere } from '../../domains/directions/direction-scope'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { Prisma } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { expiringSegmentWhere } from './renewal-segment'
import type { AnnouncementOutput } from './schemas'

// Who an announcement's push reaches beyond "active member of the club": a
// direction one only that direction's members (plus the staff, who see every
// announcement), an EXPIRING one only members due for renewal — both AND-ed.
export const announcementMemberWhere = (a: {
    audience: 'ALL' | 'EXPIRING'
    directionId: string | null
}): Prisma.WorkspaceMemberWhereInput | undefined => {
    const clauses: Prisma.WorkspaceMemberWhereInput[] = []
    if (a.directionId) {
        clauses.push({
            OR: [
                memberOfDirectionWhere(a.directionId),
                { role: { name: { in: [...STAFF_ROLES] } } },
            ],
        })
    }
    if (a.audience === 'EXPIRING') clauses.push(expiringSegmentWhere())
    if (clauses.length === 0) return undefined
    return clauses.length === 1 ? clauses[0] : { AND: clauses }
}

// Fan a published announcement out to the workspace as a push notification
// (once per announcement, author excluded), narrowed by announcementMemberWhere.
// The live feed update is handled separately by the caller (see the handlers).
export const announceToWorkspace = async (
    notifications: NotificationProducerService,
    a: {
        id: string
        workspaceId: string
        title: string
        body: string
        authorId: string
        audience: 'ALL' | 'EXPIRING'
        directionId: string | null
    },
): Promise<void> => {
    const memberWhere = announcementMemberWhere(a)
    await notifications.notifyWorkspace({
        workspaceId: a.workspaceId,
        kind: 'announcement.published',
        refId: a.id,
        topic: a.title,
        message: a.body.length > 200 ? `${a.body.slice(0, 200)}…` : a.body,
        metadata: { announcementId: a.id },
        excludeUserId: a.authorId,
        category: 'announcementsEnabled',
        // Skip if the club hid the Announcements section from the app.
        feature: 'announcements',
        ...(memberWhere ? { memberWhere } : {}),
    })
}

// Put an announcement that just went live into open feeds. A club-wide one is
// patched in with a list delta; a direction one would leak into every open
// feed that way (deltas go to the whole club), so feeds refetch their own
// filtered list instead.
export const showInOpenFeeds = (
    realtime: Pick<RealtimeEmitter, 'invalidate' | 'emitListDelta'>,
    workspaceId: string,
    a: AnnouncementOutput,
): void => {
    if (a.direction) realtime.invalidate(workspaceId, ['announcements'])
    else realtime.emitListDelta(workspaceId, 'announcements', 'create', a)
}
