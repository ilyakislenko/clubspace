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
    workspaceEventId: string | null
    checkInCode: string | null
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
            workspaceEventId: true,
            checkInCode: true,
        },
    })
    if (!s) throw new NotFoundError({ message: 'Занятие не найдено' })
    return s
}

// Write access: admin scope for anything; a coach may write a group session
// only for a group they coach; event sessions require admin scope.
export const loadSessionForWrite = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (s.groupId) {
        await rbac.assertCanWriteGroup(ctx, s.groupId)
    } else if (!rbac.canWriteAllGroups(ctx)) {
        throw new ForbiddenError({
            message: 'Менять посещения на ивентах может только администратор клуба',
        })
    }
    return s
}

// Read access: see-all scopes read anything; otherwise a coach reads a group
// session only for a group they coach. Event rosters need a see-all scope.
export const loadSessionForRead = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    workspaceId: string,
    sessionId: string,
): Promise<LoadedSession> => {
    const s = await load(prisma, workspaceId, sessionId)
    if (rbac.canSeeAllGroups(ctx)) return s
    if (s.groupId) {
        await rbac.assertCanWriteGroup(ctx, s.groupId)
        return s
    }
    throw new ForbiddenError({
        message: 'Нет доступа к этому занятию',
    })
}
