// Who a club message reaches, as a WorkspaceMember filter
// (docs/design/2026-11-26-broadcast-and-direct-messages.md §2). Students only,
// each segment from the one function that defines it for every other screen
// (domains/metrics, renewal-rules); RENEW and CALL_LIST come in as resolved
// ids (they are computed lists, not filters). Pure: segments.ts runs it.
import { memberOfDirectionWhere } from '../directions/direction-scope'
import { notAttendedWhere } from '../metrics/attendance'
import { studentWhere } from '../metrics/students'
import { owesPaymentWhere } from '../subscriptions/renewal-rules'
import type { Prisma } from '../../infrastructure/prisma'

export const CLUB_MESSAGE_SEGMENTS = [
    'ALL',
    'GROUPS',
    'DIRECTION',
    'RENEW',
    'UNPAID',
    'INACTIVE',
    'CALL_LIST',
    'MEMBERS',
] as const
export type ClubMessageSegment = (typeof CLUB_MESSAGE_SEGMENTS)[number]

// The sender's reach: null = the whole club (sport leads); otherwise the ids
// of the groups they act on as their own (ownGroupsWhere — the call-list rule,
// regardless of coachSeesAllGroups).
export type MessageScope = { groupIds: string[] | null }

export type SegmentTarget = {
    segment: ClubMessageSegment
    directionId: string | null
    groupIds: string[]
    memberIds: string[]
}

// Students of the sender's own groups; undefined = no narrowing.
export const scopeMemberWhere = (
    scope: MessageScope,
): Prisma.WorkspaceMemberWhereInput | undefined =>
    scope.groupIds === null
        ? undefined
        : { user: { groupMemberships: { some: { groupId: { in: scope.groupIds } } } } }

// The segment's own condition, AND-ed with the student base and the scope.
// `resolvedIds` carries RENEW / CALL_LIST (already narrowed to the scope).
export const segmentMemberWhere = (p: {
    workspaceId: string
    ownerId: string
    target: SegmentTarget
    scope: MessageScope
    now: Date
    resolvedIds?: readonly string[]
}): Prisma.WorkspaceMemberWhereInput => {
    const { workspaceId, ownerId, target, now } = p
    const base = studentWhere(workspaceId, ownerId)
    let condition: Prisma.WorkspaceMemberWhereInput | null
    switch (target.segment) {
        case 'ALL':
            condition = null
            break
        case 'GROUPS':
            condition = {
                user: { groupMemberships: { some: { groupId: { in: target.groupIds } } } },
            }
            break
        case 'DIRECTION':
            condition = memberOfDirectionWhere(target.directionId ?? '')
            break
        case 'UNPAID':
            condition = owesPaymentWhere
            break
        case 'INACTIVE':
            condition = notAttendedWhere(workspaceId, ownerId, now)
            break
        case 'MEMBERS':
            condition = { userId: { in: target.memberIds } }
            break
        case 'RENEW':
        case 'CALL_LIST':
            condition = { userId: { in: [...(p.resolvedIds ?? [])] } }
            break
    }
    const scoped = scopeMemberWhere(p.scope)
    const clauses = [base, condition, scoped].filter(
        (c): c is Prisma.WorkspaceMemberWhereInput => c != null,
    )
    return clauses.length === 1 ? clauses[0] : { AND: clauses }
}
