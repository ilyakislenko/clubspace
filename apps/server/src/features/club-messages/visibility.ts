import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { type CoachContext, RbacService } from '../../shared/services/rbac.service'
import { type ClubMessageRow, clubMessageSelect } from './schemas'

export type MessageViewer = {
    ctx: CoachContext
    isLead: boolean
    // The messages they see: sport leads every message of the club, anyone
    // else the ones they wrote.
    where: Prisma.ClubMessageWhereInput
}

export const resolveMessageViewer = async (
    rbac: RbacService,
    f: { workspaceId: string; invokerUserId: string; roleName: string | null; isSuperAdmin: boolean },
): Promise<MessageViewer> => {
    const ctx = await rbac.resolveCoachScope({
        userId: f.invokerUserId,
        workspaceId: f.workspaceId,
        roleName: f.roleName,
        isSuperAdmin: f.isSuperAdmin,
    })
    const isLead = rbac.canWriteAllGroups(ctx)
    return {
        ctx,
        isLead,
        where: isLead
            ? { workspaceId: f.workspaceId }
            : { workspaceId: f.workspaceId, authorId: f.invokerUserId },
    }
}

// One message the viewer may see, else 404 (never 403: the id says nothing).
export const loadVisibleMessage = async (
    prisma: Pick<PrismaService, 'clubMessage'>,
    viewer: MessageViewer,
    messageId: string,
): Promise<ClubMessageRow> => {
    const row = await prisma.clubMessage.findFirst({
        where: { ...viewer.where, id: messageId },
        select: clubMessageSelect,
    })
    if (!row) throw new NotFoundError({ message: 'Сообщение не найдено' })
    return row
}
