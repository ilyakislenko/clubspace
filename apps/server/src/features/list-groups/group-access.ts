import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import {
    type CoachContext,
    ownGroupsWhere,
    RbacService,
} from '../../shared/services/rbac.service'

// Who may open one group (its card, its roster). Reads follow the list: admin
// scope and coach_read_all see any group of the club, coach_own_only only its
// own (coached, primary or assistant, or of a managed direction). canEdit =
// whoever runs the group; only they see the roster's abonements and risk — a
// coach who merely reads every group (coachSeesAllGroups) doesn't see other
// coaches' students' money and churn, like in «Аналитика».
export const resolveGroupAccess = async (
    prisma: PrismaService,
    rbac: RbacService,
    ctx: CoachContext,
    groupId: string,
): Promise<{ canEdit: boolean }> => {
    if (rbac.canWriteAllGroups(ctx)) return { canEdit: true }
    const isOwn =
        (await prisma.group.count({
            where: {
                id: groupId,
                workspaceId: ctx.workspaceId,
                ...ownGroupsWhere(ctx.userId),
            },
        })) > 0
    if (!isOwn && !rbac.canSeeAllGroups(ctx)) {
        throw new ForbiddenError({
            message: 'Можно открыть только свои группы',
        })
    }
    return { canEdit: isOwn }
}
