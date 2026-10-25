import { type PrismaTransactionClientType } from '../../infrastructure/prisma'
import { WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'

// Who is asked to decide a member's freeze request: the owner, every ACTIVE
// admin / head coach, and the member's group coaches (primary or assistant)
// who are still coaches today. GroupCoach rows outlive a demotion, so the
// person's current role is what counts. The requester is never a recipient.
export const findFreezeRequestDeciders = async (
    db: Pick<PrismaTransactionClientType, 'groupCoach' | 'workspaceMember'>,
    p: { workspaceId: string; ownerId: string; memberUserId: string },
): Promise<string[]> => {
    const coaches = await db.groupCoach.findMany({
        where: {
            group: {
                workspaceId: p.workspaceId,
                members: { some: { userId: p.memberUserId } },
            },
        },
        select: { userId: true },
    })
    const coachIds = [...new Set(coaches.map((c) => c.userId))]
    const members = await db.workspaceMember.findMany({
        where: {
            workspaceId: p.workspaceId,
            status: 'ACTIVE',
            OR: [
                { role: { name: { in: WORKSPACE_ADMINS } } },
                { userId: { in: coachIds }, role: { name: 'coach' } },
            ],
        },
        select: { userId: true },
    })
    const ids = [p.ownerId, ...members.map((m) => m.userId)]
    return [...new Set(ids)].filter((id) => id !== p.memberUserId)
}
