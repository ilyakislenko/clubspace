import type { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import type { PrismaService } from '../../infrastructure/prisma'
import { type RoleName, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { cap, loadClubVocabulary } from '../../shared/utils/club-vocabulary'

export const REVIEW_REQUESTED_KIND = 'videoReview.requested'
export const REVIEW_ANSWERED_KIND = 'videoReview.answered'
const HEAD_COACH_ROLE: RoleName = 'head_coach'

/**
 * «Новый разбор: <name>» to the coaches of the member's groups plus the
 * club's head coaches and owner. A member in no coached group falls back to
 * all the club's staff. Never the member who sent it; the owner gets their
 * own copy below (usually no member row), so they're excluded here.
 */
export async function notifyCoachesOfReview(
    notifications: NotificationProducerService,
    prisma: PrismaService,
    p: {
        workspaceId: string
        requestId: string
        memberUserId: string
        memberName: string
        title: string
    },
): Promise<void> {
    const [workspace, groupCoaches] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: p.workspaceId },
            select: { ownerId: true },
        }),
        prisma.groupCoach.findMany({
            where: {
                group: {
                    workspaceId: p.workspaceId,
                    members: { some: { userId: p.memberUserId } },
                },
            },
            select: { userId: true },
        }),
    ])
    const ownerId = workspace?.ownerId ?? null
    const coachIds = [...new Set(groupCoaches.map((c) => c.userId))]
    // A colon, not «от <name>»: names aren't declined server-side.
    const topic = `Новый разбор: ${p.memberName}`
    const metadata = { requestId: p.requestId }
    const notIn = { notIn: [p.memberUserId, ...(ownerId ? [ownerId] : [])] }
    const staff = { role: { name: { in: [...STAFF_ROLES] } } }
    await notifications.notifyWorkspace({
        workspaceId: p.workspaceId,
        kind: REVIEW_REQUESTED_KIND,
        refId: p.requestId,
        topic,
        message: p.title,
        metadata,
        memberWhere: coachIds.length
            ? {
                  userId: notIn,
                  OR: [
                      { role: { name: HEAD_COACH_ROLE } },
                      { ...staff, userId: { in: coachIds } },
                  ],
              }
            : { ...staff, userId: notIn },
    })
    if (ownerId && ownerId !== p.memberUserId) {
        await notifications.notifyUser({
            userId: ownerId,
            kind: REVIEW_REQUESTED_KIND,
            refId: `${p.requestId}:owner`,
            topic,
            message: p.title,
            metadata,
            workspaceId: p.workspaceId,
        })
    }
}

/**
 * «Тренер ответил» (in the club's own word — педагог, инструктор…) to the
 * member, once per time a coach marks the request answered.
 */
export async function notifyMemberAnswered(
    notifications: NotificationProducerService,
    prisma: PrismaService,
    p: {
        workspaceId: string
        requestId: string
        memberUserId: string
        title: string
        answeredAt: Date
    },
): Promise<void> {
    const vocabulary = await loadClubVocabulary(prisma, p.workspaceId)
    await notifications.notifyUser({
        userId: p.memberUserId,
        kind: REVIEW_ANSWERED_KIND,
        refId: `${p.requestId}:${p.answeredAt.toISOString()}`,
        topic: `${cap(vocabulary.coach.nom)} ответил`,
        message: p.title,
        metadata: { requestId: p.requestId },
        workspaceId: p.workspaceId,
    })
}
