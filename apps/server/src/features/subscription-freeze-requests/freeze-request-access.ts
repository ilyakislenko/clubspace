import { PrismaService } from '../../infrastructure/prisma'
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'

const STATUS_MESSAGE: Record<string, string> = {
    APPROVED: 'Заявка уже одобрена',
    DECLINED: 'Заявка уже отклонена',
    CANCELLED: 'Ученик отменил эту заявку',
}

// Shared by approve and decline: who may decide a member's freeze request.
// Admin scope (owner included) decides any; a coach decides the requests of
// members in their groups (primary or assistant), never their own.
export const loadDecidableRequest = async (
    prisma: PrismaService,
    rbac: RbacService,
    f: {
        workspaceId: string
        requestId: string
        invokerUserId: string
        roleName: string | null
        isSuperAdmin: boolean
    },
) => {
    const ctx = await rbac.resolveCoachScope({
        userId: f.invokerUserId,
        workspaceId: f.workspaceId,
        roleName: f.roleName,
        isSuperAdmin: f.isSuperAdmin,
    })
    const row = await prisma.subscriptionFreezeRequest.findFirst({
        where: { id: f.requestId, workspaceId: f.workspaceId },
        include: {
            user: {
                select: { firstname: true, lastname: true, email: true },
            },
            subscription: { select: { plan: { select: { name: true } } } },
            workspace: { select: { timezone: true } },
        },
    })
    if (!row) {
        throw new NotFoundError({ message: 'Заявка на заморозку не найдена' })
    }
    if (!rbac.canWriteAllGroups(ctx) && row.userId === f.invokerUserId) {
        throw new ForbiddenError({
            message: 'Нельзя рассматривать собственную заявку на заморозку',
        })
    }
    await rbac.assertCanWriteMember(ctx, row.userId)
    if (row.status !== 'PENDING') {
        throw new ConflictError({
            message: STATUS_MESSAGE[row.status] ?? 'Заявку уже рассмотрели',
        })
    }
    return row
}

export const RACE_MESSAGE = 'Заявку только что рассмотрели — обновите экран'
