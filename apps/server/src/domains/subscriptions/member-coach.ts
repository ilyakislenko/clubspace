import {
    MemberStatus,
    type PrismaTransactionClientType,
} from '../../infrastructure/prisma'

// The coach a member should ask about their abonement: the primary coach of
// the group they joined first, when they are still part of this club (the owner,
// or an ACTIVE member — a coach who left must not be advertised). The name is
// «Фамилия Имя» like everywhere in the club and never falls back to the e-mail
// (it is shown to the member), so a coach without a name reads as null.
export type MemberCoach = {
    userId: string
    name: string | null
    phone: string | null
}

type Db = Pick<PrismaTransactionClientType, 'groupMember' | 'workspaceMember'>

// Which of these users are still part of the club: the owner (who has no
// WorkspaceMember row) or an ACTIVE member. Group assignments outlive removal
// and demotion, so anything shown to students about a coach goes through this.
export const findActiveClubUserIds = async (
    db: Pick<PrismaTransactionClientType, 'workspaceMember'>,
    p: { workspaceId: string; ownerId: string; userIds: string[] },
): Promise<Set<string>> => {
    const ids = [...new Set(p.userIds)]
    const active = new Set(ids.filter((id) => id === p.ownerId))
    const others = ids.filter((id) => id !== p.ownerId)
    if (others.length > 0) {
        const members = await db.workspaceMember.findMany({
            where: {
                workspaceId: p.workspaceId,
                userId: { in: others },
                status: MemberStatus.ACTIVE,
            },
            select: { userId: true },
        })
        for (const m of members) active.add(m.userId)
    }
    return active
}

export const findMemberCoach = async (
    db: Db,
    p: { workspaceId: string; userId: string },
): Promise<MemberCoach | null> => {
    const membership = await db.groupMember.findFirst({
        where: { userId: p.userId, group: { workspaceId: p.workspaceId } },
        orderBy: { joinedAt: 'asc' },
        select: {
            group: {
                select: {
                    workspace: { select: { ownerId: true } },
                    coach: {
                        select: {
                            id: true,
                            firstname: true,
                            lastname: true,
                            phone: true,
                            status: true,
                        },
                    },
                },
            },
        },
    })
    const coach = membership?.group.coach
    if (!coach || coach.status === 'DELETED') return null
    const active = await findActiveClubUserIds(db, {
        workspaceId: p.workspaceId,
        ownerId: membership.group.workspace.ownerId,
        userIds: [coach.id],
    })
    if (!active.has(coach.id)) return null
    const name = [coach.lastname, coach.firstname]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    return { userId: coach.id, name: name || null, phone: coach.phone }
}
