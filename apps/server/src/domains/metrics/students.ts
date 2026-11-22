// Who is counted: the people behind every club figure
// (docs/design/2026-11-08-admin-cleanup.md B2, glossary). Every count of
// «участники» / «ученики» on the dashboard, the forecast, the members list and
// the ClubSpace bill starts from these filters, so two screens can only differ
// by an extra condition their label names.
import type { Prisma, PrismaService } from '../../infrastructure/prisma'

// «Участники»: everyone on the club's roster — students, staff and the owner's
// own row — except pending invitations (they live in «Ожидают приглашения»).
export const memberRosterWhere = (workspaceId: string): Prisma.WorkspaceMemberWhereInput => ({
    workspaceId,
    status: { not: 'INVITED' },
})

// «Ученики»: active memberships (not pending, suspended or blocked) with the
// student role (dependents included); the owner and staff (coach, head coach,
// admin) never count. A deleted account has no membership left (purgeAccount).
export const studentWhere = (
    workspaceId: string,
    ownerId: string,
): Prisma.WorkspaceMemberWhereInput => ({
    workspaceId,
    status: 'ACTIVE',
    role: { name: 'user' },
    userId: { not: ownerId },
})

// The students of one view: the club, or the part of it a coach or a filter
// narrows to (`where` is AND-ed, so its own `userId` never replaces the owner
// exclusion).
export type StudentScope = {
    workspaceId: string
    ownerId: string
    where?: Prisma.WorkspaceMemberWhereInput
}

export const studentsIn = (scope: StudentScope): Prisma.WorkspaceMemberWhereInput =>
    scope.where
        ? { AND: [studentWhere(scope.workspaceId, scope.ownerId), scope.where] }
        : studentWhere(scope.workspaceId, scope.ownerId)

// metric `students_total`
export const countStudents = (prisma: PrismaService, scope: StudentScope): Promise<number> =>
    prisma.workspaceMember.count({ where: studentsIn(scope) })

// metric `new_students_today`: students whose membership started at or after
// `since` (the club-local midnight).
export const countNewStudents = (
    prisma: PrismaService,
    scope: StudentScope,
    since: Date,
): Promise<number> =>
    prisma.workspaceMember.count({
        where: { AND: [studentsIn(scope), { createdAt: { gte: since } }] },
    })
