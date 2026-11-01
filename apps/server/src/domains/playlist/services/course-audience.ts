// Pure rules for "who may watch a course" (CourseAudience) and locked
// progression. No Prisma here, so every branch is unit-tested directly; the
// queries that feed these live in CourseAccessService.
//
// Product decision (docs/design/2026-11-01-content-gating.md):
//  - GROUP: the course is HIDDEN from students outside the groups — it's a
//    private curriculum ("Дети", "Соревновательная"), not something to sell.
//  - DIRECTION: same as GROUP, for every group of a direction ("БЖЖ") — the
//    viewer's directions are the directions of the groups they train in or
//    coach (loadMemberDirectionIds).
//  - RANK / PLAN: the course is shown as a locked TEASER with the reason, so a
//    student sees what the next belt or a better abonement opens.
//  - Staff (owner, admin, head coach, coach) always see and play everything.

import { z } from 'zod'

import type { Prisma } from '../../../infrastructure/prisma'
import { STAFF_ROLES } from '../../../shared/decorators/roles.decorator'
import { memberOfDirectionWhere } from '../../directions/direction-scope'

export type CourseAudienceKindValue = 'GROUP' | 'DIRECTION' | 'RANK' | 'PLAN'

export const COURSE_LOCK_KINDS = [
    'GROUP',
    'DIRECTION',
    'RANK',
    'PLAN',
    'PROGRESSION',
] as const
export type CourseLockKind = (typeof COURSE_LOCK_KINDS)[number]

// Why a course or lesson can't be opened. Null in the DTOs = open.
export const CourseLockSchema = z.object({
    kind: z.enum(COURSE_LOCK_KINDS),
    // Russian, ready to show as-is.
    reason: z.string(),
})
export type CourseLock = z.infer<typeof CourseLockSchema>

// Shape of a CourseAudience row with the names the reasons need. Targets are
// null once the group/direction/level/plan was deleted (SetNull) — such a row matches
// nobody, which keeps the course closed rather than opening it to the club.
export type AudienceRow = {
    kind: CourseAudienceKindValue
    groupId: string | null
    rankLevelId: string | null
    planId: string | null
    directionId: string | null
    group: { name: string } | null
    direction: { name: string } | null
    rankLevel: {
        name: string
        order: number
        ladderId: string
        ladder: { name: string }
    } | null
    plan: { name: string } | null
}

// Prisma `select` matching AudienceRow, so callers can't drift from it.
export const audienceRowSelect = {
    kind: true,
    groupId: true,
    rankLevelId: true,
    planId: true,
    directionId: true,
    group: { select: { name: true } },
    direction: { select: { name: true } },
    rankLevel: {
        select: {
            name: true,
            order: true,
            ladderId: true,
            ladder: { select: { name: true } },
        },
    },
    plan: { select: { name: true } },
} as const

// What we know about the person asking. Staff skip every rule.
export type CourseViewer = {
    isStaff: boolean
    groupIds: ReadonlySet<string>
    // Directions of the groups the viewer trains in or coaches.
    directionIds: ReadonlySet<string>
    // Usable abonements only (isSubscriptionUsable).
    planIds: ReadonlySet<string>
    // Current level order per ladder (latest promotion wins).
    rankOrderByLadder: ReadonlyMap<string, number>
}

export const STAFF_VIEWER: CourseViewer = {
    isStaff: true,
    groupIds: new Set(),
    directionIds: new Set(),
    planIds: new Set(),
    rankOrderByLadder: new Map(),
}

export const PROGRESSION_LOCK_REASON = 'Сначала посмотрите предыдущий урок'

const quoted = (names: string[]) => names.map((n) => `«${n}»`).join(', ')

const namesOf = (names: Array<string | null | undefined>): string[] => [
    ...new Set(names.filter((n): n is string => !!n)),
]

export const groupLockReason = (rows: AudienceRow[]): string => {
    const names = namesOf(rows.map((r) => r.group?.name))
    if (names.length === 0) return 'Для отдельных групп'
    return names.length === 1
        ? `Для группы ${quoted(names)}`
        : `Для групп ${quoted(names)}`
}

export const directionLockReason = (rows: AudienceRow[]): string => {
    const names = namesOf(rows.map((r) => r.direction?.name))
    if (names.length === 0) return 'Для отдельных направлений'
    return names.length === 1
        ? `Для направления ${quoted(names)}`
        : `Для направлений ${quoted(names)}`
}

export const rankLockReason = (rows: AudienceRow[]): string => {
    const names = namesOf(rows.map((r) => r.rankLevel?.name))
    if (names.length === 0) return 'Доступно с определённого уровня'
    return `Доступно с уровня ${names.map((n) => `«${n}»`).join(' или ')}`
}

export const planLockReason = (rows: AudienceRow[]): string => {
    const names = namesOf(rows.map((r) => r.plan?.name))
    if (names.length === 0) return 'Доступно по отдельным абонементам'
    return names.length === 1
        ? `Доступно по абонементу ${quoted(names)}`
        : `Доступно по абонементам ${quoted(names)}`
}

// Minimum-level rule: current order on that ladder >= the row's level order.
const matchesRank = (row: AudienceRow, v: CourseViewer) => {
    if (!row.rankLevel) return false
    const current = v.rankOrderByLadder.get(row.rankLevel.ladderId)
    return current !== undefined && current >= row.rankLevel.order
}

export type AudienceVerdict = {
    // Not listed at all (GROUP / DIRECTION mismatch).
    hidden: boolean
    // Listed but closed (RANK/PLAN mismatch), or the GROUP / DIRECTION reason
    // when hidden.
    lock: CourseLock | null
}

const OPEN: AudienceVerdict = { hidden: false, lock: null }

export const evaluateCourseAudience = (
    rows: AudienceRow[],
    viewer: CourseViewer,
): AudienceVerdict => {
    if (viewer.isStaff || rows.length === 0) return OPEN

    const byKind = (kind: CourseAudienceKindValue) =>
        rows.filter((r) => r.kind === kind)

    const groups = byKind('GROUP')
    if (
        groups.length > 0 &&
        !groups.some((r) => !!r.groupId && viewer.groupIds.has(r.groupId))
    ) {
        return {
            hidden: true,
            lock: { kind: 'GROUP', reason: groupLockReason(groups) },
        }
    }
    const directions = byKind('DIRECTION')
    if (
        directions.length > 0 &&
        !directions.some(
            (r) => !!r.directionId && viewer.directionIds.has(r.directionId),
        )
    ) {
        return {
            hidden: true,
            lock: { kind: 'DIRECTION', reason: directionLockReason(directions) },
        }
    }
    // Rank before plan: buying an abonement doesn't help a white belt.
    const ranks = byKind('RANK')
    if (ranks.length > 0 && !ranks.some((r) => matchesRank(r, viewer))) {
        return {
            hidden: false,
            lock: { kind: 'RANK', reason: rankLockReason(ranks) },
        }
    }
    const plans = byKind('PLAN')
    if (
        plans.length > 0 &&
        !plans.some((r) => !!r.planId && viewer.planIds.has(r.planId))
    ) {
        return {
            hidden: false,
            lock: { kind: 'PLAN', reason: planLockReason(plans) },
        }
    }
    return OPEN
}

// Prisma `where` fragment that drops GROUP- / DIRECTION-restricted courses the
// viewer isn't in, so list pagination and totals stay right. A row whose
// group/direction was deleted (id null) never matches `in`, so such a course
// stays hidden.
export const buildCourseAudienceWhere = (viewer: CourseViewer) =>
    viewer.isStaff
        ? []
        : [
              {
                  OR: [
                      { audience: { none: { kind: 'GROUP' as const } } },
                      {
                          audience: {
                              some: {
                                  kind: 'GROUP' as const,
                                  groupId: { in: [...viewer.groupIds] },
                              },
                          },
                      },
                  ],
              },
              {
                  OR: [
                      { audience: { none: { kind: 'DIRECTION' as const } } },
                      {
                          audience: {
                              some: {
                                  kind: 'DIRECTION' as const,
                                  directionId: { in: [...viewer.directionIds] },
                              },
                          },
                      },
                  ],
              },
          ]

// One line for staff UIs: «Для группы «Дети» · Для направления «БЖЖ» · …».
// Null when the course is open to the whole club.
export const describeAudience = (rows: AudienceRow[]): string | null => {
    const parts: string[] = []
    const groups = rows.filter((r) => r.kind === 'GROUP')
    const directions = rows.filter((r) => r.kind === 'DIRECTION')
    const ranks = rows.filter((r) => r.kind === 'RANK')
    const plans = rows.filter((r) => r.kind === 'PLAN')
    if (groups.length > 0) parts.push(groupLockReason(groups))
    if (directions.length > 0) parts.push(directionLockReason(directions))
    if (ranks.length > 0) parts.push(rankLockReason(ranks))
    if (plans.length > 0) parts.push(planLockReason(plans))
    return parts.length > 0 ? parts.join(' · ') : null
}

// Locked progression: lessons in course order; a lesson is locked while the
// nearest previous required (non-optional) lesson isn't completed. The first
// lesson is always open. Returns the set of locked videoIds.
export const computeProgressionLocks = (
    lessons: Array<{ videoId: string; isOptional: boolean }>,
    completedVideoIds: ReadonlySet<string>,
): Set<string> => {
    const locked = new Set<string>()
    let previousRequiredDone = true
    for (const lesson of lessons) {
        if (!previousRequiredDone) locked.add(lesson.videoId)
        if (!lesson.isOptional) {
            previousRequiredDone = completedVideoIds.has(lesson.videoId)
        }
    }
    return locked
}

// The kinds that hide a course (vs. teasing it) — what push targeting reads.
export const HIDING_AUDIENCE_KINDS = ['GROUP', 'DIRECTION'] as const

// One course's GROUP / DIRECTION rows → courseAudienceMemberWhere input.
export const hidingAudienceIds = (
    rows: Array<{
        kind: CourseAudienceKindValue
        groupId: string | null
        directionId: string | null
    }>,
) => ({
    groupIds: rows.filter((r) => r.kind === 'GROUP').map((r) => r.groupId),
    directionIds: rows
        .filter((r) => r.kind === 'DIRECTION')
        .map((r) => r.directionId),
})

// `memberWhere` for a "new course / new video" push about content live in
// `courses` (each with the ids of its GROUP and DIRECTION audience rows; null =
// a deleted group/direction, which matches nobody). undefined = notify the
// whole club (some course has neither); otherwise staff plus, per course, the
// members it is visible to (in one of its groups AND in one of its directions),
// so a hidden course's title doesn't reach students it is hidden from.
// Rank/plan courses are teasers: everyone hears.
export const courseAudienceMemberWhere = (
    courses: Array<{
        groupIds: Array<string | null>
        directionIds: Array<string | null>
    }>,
): Prisma.WorkspaceMemberWhereInput | undefined => {
    if (
        courses.some(
            (c) => c.groupIds.length === 0 && c.directionIds.length === 0,
        )
    ) {
        return undefined
    }
    const live = (ids: Array<string | null>) => [
        ...new Set(ids.filter((id): id is string => id !== null)),
    ]
    const clauses = new Map<string, Prisma.WorkspaceMemberWhereInput>()
    for (const c of courses) {
        const parts: Prisma.WorkspaceMemberWhereInput[] = []
        if (c.groupIds.length > 0) {
            parts.push({
                user: {
                    groupMemberships: {
                        some: { groupId: { in: live(c.groupIds) } },
                    },
                },
            })
        }
        if (c.directionIds.length > 0) {
            parts.push({ OR: live(c.directionIds).map(memberOfDirectionWhere) })
        }
        const clause = parts.length === 1 ? parts[0] : { AND: parts }
        // Courses with the same audience share one clause.
        clauses.set(JSON.stringify(clause), clause)
    }
    return {
        OR: [
            { role: { name: { in: [...STAFF_ROLES] } } },
            ...clauses.values(),
        ],
    }
}
