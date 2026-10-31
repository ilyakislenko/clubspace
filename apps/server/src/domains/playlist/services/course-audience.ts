// Pure rules for "who may watch a course" (CourseAudience) and locked
// progression. No Prisma here, so every branch is unit-tested directly; the
// queries that feed these live in CourseAccessService.
//
// Product decision (docs/design/2026-11-01-content-gating.md):
//  - GROUP: the course is HIDDEN from students outside the groups — it's a
//    private curriculum ("Дети", "Соревновательная"), not something to sell.
//  - RANK / PLAN: the course is shown as a locked TEASER with the reason, so a
//    student sees what the next belt or a better abonement opens.
//  - Staff (owner, admin, head coach, coach) always see and play everything.

import { z } from 'zod'

import { STAFF_ROLES } from '../../../shared/decorators/roles.decorator'

export type CourseAudienceKindValue = 'GROUP' | 'RANK' | 'PLAN'

export const COURSE_LOCK_KINDS = ['GROUP', 'RANK', 'PLAN', 'PROGRESSION'] as const
export type CourseLockKind = (typeof COURSE_LOCK_KINDS)[number]

// Why a course or lesson can't be opened. Null in the DTOs = open.
export const CourseLockSchema = z.object({
    kind: z.enum(COURSE_LOCK_KINDS),
    // Russian, ready to show as-is.
    reason: z.string(),
})
export type CourseLock = z.infer<typeof CourseLockSchema>

// Shape of a CourseAudience row with the names the reasons need. Targets are
// null once the group/level/plan was deleted (SetNull) — such a row matches
// nobody, which keeps the course closed rather than opening it to the club.
export type AudienceRow = {
    kind: CourseAudienceKindValue
    groupId: string | null
    rankLevelId: string | null
    planId: string | null
    group: { name: string } | null
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
    group: { select: { name: true } },
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
    // Usable abonements only (isSubscriptionUsable).
    planIds: ReadonlySet<string>
    // Current level order per ladder (latest promotion wins).
    rankOrderByLadder: ReadonlyMap<string, number>
}

export const STAFF_VIEWER: CourseViewer = {
    isStaff: true,
    groupIds: new Set(),
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
    // Not listed at all (GROUP mismatch).
    hidden: boolean
    // Listed but closed (RANK/PLAN mismatch), or the GROUP reason when hidden.
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

// Prisma `where` fragment that drops GROUP-restricted courses the viewer isn't
// in, so list pagination and totals stay right. A row whose group was deleted
// (groupId null) never matches `in`, so such a course stays hidden.
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
          ]

// One line for staff UIs: «Группы «Дети» · с уровня «Синий пояс» · …».
// Null when the course is open to the whole club.
export const describeAudience = (rows: AudienceRow[]): string | null => {
    const parts: string[] = []
    const groups = rows.filter((r) => r.kind === 'GROUP')
    const ranks = rows.filter((r) => r.kind === 'RANK')
    const plans = rows.filter((r) => r.kind === 'PLAN')
    if (groups.length > 0) parts.push(groupLockReason(groups))
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

// `memberWhere` for a "new course / new video" push about content live in
// `courses` (each with the group ids of its GROUP audience rows; null = a
// deleted group). undefined = notify the whole club; otherwise only staff and
// members of those groups, so a group-only course's title doesn't reach
// students it is hidden from. Rank/plan courses are teasers: everyone hears.
export const groupAudienceMemberWhere = (
    courses: Array<{ groupIds: Array<string | null> }>,
) => {
    if (courses.some((c) => c.groupIds.length === 0)) return undefined
    const groupIds = [
        ...new Set(
            courses
                .flatMap((c) => c.groupIds)
                .filter((id): id is string => id !== null),
        ),
    ]
    return {
        OR: [
            { role: { name: { in: [...STAFF_ROLES] } } },
            { user: { groupMemberships: { some: { groupId: { in: groupIds } } } } },
        ],
    }
}
