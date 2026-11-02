import { memberOfDirectionWhere } from '../../domains/directions/direction-scope'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { Prisma } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { expiringSegmentWhere } from './renewal-segment'
import type { AnnouncementOutput } from './schemas'

// Who an announcement's push reaches beyond "active member of the club": a
// direction one only that direction's members, a group one only the students
// and coaches of its groups (a child's notice goes on to its guardians) — plus
// the staff, who see every announcement; an EXPIRING one only members due for
// renewal — AND-ed.
export const announcementMemberWhere = (a: {
    audience: 'ALL' | 'EXPIRING'
    directionId: string | null
    groups: Array<{ groupId: string | null }>
}): Prisma.WorkspaceMemberWhereInput | undefined => {
    const clauses: Prisma.WorkspaceMemberWhereInput[] = []
    const staff = { role: { name: { in: [...STAFF_ROLES] } } }
    if (a.directionId) {
        clauses.push({ OR: [memberOfDirectionWhere(a.directionId), staff] })
    }
    if (a.groups.length > 0) {
        // Deleted groups (null) match nobody.
        const groupId = {
            in: a.groups.flatMap((g) => (g.groupId ? [g.groupId] : [])),
        }
        clauses.push({
            OR: [
                {
                    user: {
                        OR: [
                            { groupMemberships: { some: { groupId } } },
                            { coachAssignments: { some: { groupId } } },
                        ],
                    },
                },
                staff,
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
        groups: Array<{ groupId: string | null }>
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

// Narrowed to a direction or to groups (a stored row: a target group that was
// deleted still narrows).
export const isTargeted = (a: {
    directionId: string | null
    groups: unknown[]
}): boolean => a.directionId != null || a.groups.length > 0

// Put an announcement that just went live into open feeds. A club-wide one is
// patched in with a list delta; a targeted one would leak into every open
// feed that way (deltas go to the whole club), so feeds refetch their own
// filtered list instead.
export const showInOpenFeeds = (
    realtime: Pick<RealtimeEmitter, 'invalidate' | 'emitListDelta'>,
    workspaceId: string,
    a: AnnouncementOutput,
    targeted: boolean,
): void => {
    if (targeted) realtime.invalidate(workspaceId, ['announcements'])
    else realtime.emitListDelta(workspaceId, 'announcements', 'create', a)
}
