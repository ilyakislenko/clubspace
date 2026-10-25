import type { PrismaTransactionClientType } from '../../infrastructure/prisma'

// The coach a member should ask about their abonement: the primary coach of
// the group they joined first. The name never falls back to the e-mail (it is
// shown to the member), so a coach without a name reads as null.
export type MemberCoach = {
    userId: string
    name: string | null
    phone: string | null
}

type Db = Pick<PrismaTransactionClientType, 'groupMember'>

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
    const name = [coach.firstname, coach.lastname]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    return { userId: coach.id, name: name || null, phone: coach.phone }
}
