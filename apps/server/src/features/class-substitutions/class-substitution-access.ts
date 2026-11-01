import { PrismaService } from '../../infrastructure/prisma'
import {
    COACHING_ROLES,
    type RoleName,
} from '../../shared/decorators/roles.decorator'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { CoachContext, RbacService } from '../../shared/services/rbac.service'
import {
    type ClassSubstitutionRow,
    classSubstitutionInclude,
} from './schemas'

export type SubstitutionGroup = {
    directionId: string | null
    coaches: { userId: string }[]
}

// Who runs a group decides on its substitutions: a club admin, one of its
// coaches, the manager of its direction. Resolved once per request (one
// query), then applied per row.
export const loadDecider = async (
    rbac: RbacService,
    ctx: CoachContext,
): Promise<(group: SubstitutionGroup) => boolean> => {
    const managed = await rbac.managedDirectionIds(ctx)
    return (group) =>
        managed === null ||
        group.coaches.some((c) => c.userId === ctx.userId) ||
        (!!group.directionId && managed.includes(group.directionId))
}

export const loadSubstitutionOrThrow = async (
    prisma: PrismaService,
    workspaceId: string,
    id: string,
): Promise<ClassSubstitutionRow> => {
    const row = await prisma.classSubstitution.findFirst({
        where: { id, workspaceId },
        include: classSubstitutionInclude,
    })
    if (!row) throw new NotFoundError({ message: 'Замена не найдена' })
    return row
}

// The attendance session of the class (if already opened) belongs to whoever
// runs it — the coaches report and «кто вёл» read session.coachId.
export const syncSessionCoach = async (
    prisma: PrismaService,
    row: { workspaceId: string; occurrenceKey: string },
    coachId: string | null,
): Promise<void> => {
    await prisma.attendanceSession.updateMany({
        where: { workspaceId: row.workspaceId, occurrenceKey: row.occurrenceKey },
        data: { coachId },
    })
}

// Who may stand in for a coach: the club owner or an active member with a
// coaching role.
export const coachCandidatesWhere = (workspaceId: string, ownerId: string) => ({
    OR: [
        { id: ownerId },
        {
            workspaceMemberships: {
                some: {
                    workspaceId,
                    status: 'ACTIVE' as const,
                    role: { name: { in: COACHING_ROLES as RoleName[] } },
                },
            },
        },
    ],
})
