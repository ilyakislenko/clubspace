import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'

// Who an announcement is addressed to: the whole club (neither set), one
// direction, or a set of groups — never a direction and groups together.

// Validates a requested target and returns the directions the direction rule
// (RbacService.assertCanManageDirection) must clear for it: the direction
// itself (null = club-wide, admin only), or the direction of every group (a
// group without one is club-wide too). So a direction manager addresses only
// groups of the directions they run, and a coach running none can't post.
export const checkAnnouncementTarget = async (
    prisma: Pick<PrismaService, 'direction' | 'group'>,
    workspaceId: string,
    target: { directionId: string | null; groupIds: string[] },
): Promise<Array<string | null>> => {
    if (target.groupIds.length === 0) {
        await assertDirectionInWorkspace(
            prisma,
            workspaceId,
            target.directionId,
        )
        return [target.directionId]
    }
    if (target.directionId) {
        throw new BadRequestError({
            message: 'Выберите направление или группы, а не то и другое',
        })
    }
    // Ids from another club would otherwise let a manager probe or bind
    // foreign groups.
    const groups = await prisma.group.findMany({
        where: { id: { in: target.groupIds }, workspaceId },
        select: { directionId: true },
    })
    if (groups.length !== target.groupIds.length) {
        throw new NotFoundError({ message: 'Группа не найдена' })
    }
    return groups.map((g) => g.directionId)
}

// The same directions for a stored announcement; a target row whose group was
// deleted counts as club-wide (admin only).
export const storedTargetDirectionIds = (a: {
    directionId: string | null
    groups: Array<{ group: { directionId: string | null } | null }>
}): Array<string | null> =>
    a.groups.length === 0
        ? [a.directionId]
        : a.groups.map((g) => g.group?.directionId ?? null)

// What storedTargetDirectionIds and isTargeted read.
export const storedTargetSelect = {
    directionId: true,
    groups: {
        select: { groupId: true, group: { select: { directionId: true } } },
    },
} as const

export const uniqueIds = (ids: string[] | undefined): string[] | undefined =>
    ids === undefined ? undefined : [...new Set(ids)]

// Feed filter for a member: club-wide ones, ones of a direction they train in
// or coach, and ones addressed to a group they train in or coach.
export const visibleToMemberWhere = (mine: {
    directionIds: string[]
    groupIds: string[]
}): Prisma.AnnouncementWhereInput => ({
    OR: [
        { directionId: null, groups: { none: {} } },
        { directionId: { in: mine.directionIds } },
        { groups: { some: { groupId: { in: mine.groupIds } } } },
    ],
})

// Staff list filter: announcements owned by these directions — of one of them,
// or addressed only to groups of them.
export const ownedByDirectionsWhere = (
    directionIds: string[],
): Prisma.AnnouncementWhereInput => ({
    OR: [
        { directionId: { in: directionIds } },
        {
            groups: {
                some: {},
                every: { group: { directionId: { in: directionIds } } },
            },
        },
    ],
})

// Ids of the groups a user trains in or coaches within one club.
export const loadMemberGroupIds = async (
    prisma: Pick<PrismaService, 'groupMember' | 'groupCoach'>,
    workspaceId: string,
    userId: string,
): Promise<string[]> => {
    const [trains, coaches] = await Promise.all([
        prisma.groupMember.findMany({
            where: { userId, group: { workspaceId } },
            select: { groupId: true },
        }),
        prisma.groupCoach.findMany({
            where: { userId, group: { workspaceId } },
            select: { groupId: true },
        }),
    ])
    return [...new Set([...trains, ...coaches].map((r) => r.groupId))]
}
