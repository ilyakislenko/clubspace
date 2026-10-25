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
    // The owner has no WorkspaceMember row.
    if (coach.id !== membership.group.workspace.ownerId) {
        const member = await db.workspaceMember.findFirst({
            where: {
                workspaceId: p.workspaceId,
                userId: coach.id,
                status: MemberStatus.ACTIVE,
            },
            select: { id: true },
        })
        if (!member) return null
    }
    const name = [coach.lastname, coach.firstname]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    return { userId: coach.id, name: name || null, phone: coach.phone }
}
