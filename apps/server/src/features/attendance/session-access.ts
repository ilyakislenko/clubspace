import { PrismaService } from '../../infrastructure/prisma'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CoachContext, RbacService } from '../../shared/services/rbac.service'

export type LoadedSession = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
    workspaceEventId: string | null
    checkInCode: string | null
    coachId: string | null
    isPersonal: boolean
    startAt: Date
    timezone: string
}

const load = async (
    prisma: PrismaService,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await prisma.attendanceSession.findFirst({
        where: { id: sessionId, workspaceId },
        select: {
            id: true,
            workspaceId: true,
            groupId: true,
            slotId: true,
            occurrenceKey: true,
            workspaceEventId: true,
            checkInCode: true,
            coachId: true,
            isPersonal: true,
            startAt: true,
            timezone: true,
        },
    })
    if (!s) throw new NotFoundError({ message: 'Занятие не найдено' })
    return s
}

// Write access: admin scope for anything; a group session for whoever may
// mark that class (`mark`: its group's coaches, the direction's manager, the
// approved substitute, any coach when the club allows it) or only for whoever
// runs the group (`manage`, e.g. deleting the session); event sessions
// require admin scope.
export const loadSessionForWrite = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
    access: 'mark' | 'manage' = 'mark',
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (s.isPersonal) {
        if (rbac.canWriteAllGroups(ctx) || s.coachId === ctx.userId) return s
        throw new NotFoundError({ message: 'Занятие не найдено' })
    }
    if (s.groupId) {
        if (access === 'mark') {
            // Only slot occurrences have substitutes; an ad-hoc class has none.
            await rbac.assertCanMarkClass(
                ctx,
                s.groupId,
                s.slotId ? s.occurrenceKey : null,
            )
        } else {
            await rbac.assertCanWriteGroup(ctx, s.groupId)
        }
    } else if (!rbac.canWriteAllGroups(ctx)) {
        throw new ForbiddenError({
            message: 'Менять посещения на ивентах может только администратор клуба',
        })
    }
    return s
}

// Read access: see-all scopes read anything; otherwise a coach reads a group
// session of a class they may mark. Event rosters need a see-all scope.
export const loadSessionForRead = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (s.isPersonal) {
        if (rbac.canWriteAllGroups(ctx) || s.coachId === ctx.userId) return s
        throw new NotFoundError({ message: 'Занятие не найдено' })
    }
    if (rbac.canSeeAllGroups(ctx)) return s
    if (s.groupId) {
        await rbac.assertCanMarkClass(
            ctx,
            s.groupId,
            s.slotId ? s.occurrenceKey : null,
        )
        return s
    }
    throw new ForbiddenError({
        message: 'Нет доступа к этому занятию',
    })
}
