// Directions (disciplines of one club: БЖЖ, ММА, …) — the one place that says
// which session or member belongs to which direction. Every direction-aware
// read (achievements, leaderboard, announcements, course audience) goes through
// these so the rules can't drift. Abonement scopes (a set of directions) live
// in domains/subscriptions/current-subscriptions.ts and visit-abonement.ts.
//
// - A session's direction is its group's direction, or its event's for an
//   event session. Personal and ad-hoc sessions without a group have none.
// - A member's directions are the directions of the groups they train in or
//   coach. There is no separate membership: who trains where is already the
//   group roster (docs/design/2026-11-01-directions.md).
// - null on a tagged row (achievement, announcement, …) = club-wide.

import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'

type Db = Pick<PrismaService, 'groupMember' | 'groupCoach'>

// Direction of one attendance session (null = none / club-wide).
export const loadSessionDirectionId = async (
    prisma: Pick<PrismaService, 'attendanceSession'>,
    sessionId: string,
): Promise<string | null> => {
    const s = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        select: sessionDirectionSelect,
    })
    return s ? sessionDirectionId(s) : null
}

// A directionId from a request must be one of this club's directions — a
// foreign id would otherwise tag a row with another club's discipline.
// null/undefined pass through (club-wide / field not sent).
export const assertDirectionInWorkspace = async (
    prisma: Pick<PrismaService, 'direction'>,
    workspaceId: string,
    directionId: string | null | undefined,
): Promise<void> => {
    if (!directionId) return
    const found = await prisma.direction.findFirst({
        where: { id: directionId, workspaceId },
        select: { id: true },
    })
    if (!found) {
        throw new NotFoundError({ message: 'Направление не найдено' })
    }
}

// AttendanceSession filter: sessions of this direction.
export const sessionInDirectionWhere = (
    directionId: string,
): Prisma.AttendanceSessionWhereInput => ({
    OR: [{ group: { directionId } }, { workspaceEvent: { directionId } }],
})

// Select on AttendanceSession that `sessionDirectionId` reads.
export const sessionDirectionSelect = {
    group: { select: { directionId: true } },
    workspaceEvent: { select: { directionId: true } },
} as const

export const sessionDirectionId = (s: {
    group: { directionId: string | null } | null
    workspaceEvent: { directionId: string | null } | null
}): string | null =>
    s.group?.directionId ?? s.workspaceEvent?.directionId ?? null

// WorkspaceMember filter: members who train in or coach a group of this
// direction (push fan-out of a direction-targeted announcement).
export const memberOfDirectionWhere = (
    directionId: string,
): Prisma.WorkspaceMemberWhereInput => ({
    user: {
        OR: [
            { groupMemberships: { some: { group: { directionId } } } },
            { coachAssignments: { some: { group: { directionId } } } },
        ],
    },
})

// Ids of the directions a user trains in or coaches within one club.
export const loadMemberDirectionIds = async (
    prisma: Db,
    workspaceId: string,
    userId: string,
): Promise<Set<string>> => {
    const [trains, coaches] = await Promise.all([
        prisma.groupMember.findMany({
            where: {
                userId,
                group: { workspaceId, directionId: { not: null } },
            },
            select: { group: { select: { directionId: true } } },
        }),
        prisma.groupCoach.findMany({
            where: {
                userId,
                group: { workspaceId, directionId: { not: null } },
            },
            select: { group: { select: { directionId: true } } },
        }),
    ])
    const ids = new Set<string>()
    for (const r of [...trains, ...coaches]) {
        if (r.group.directionId) ids.add(r.group.directionId)
    }
    return ids
}
