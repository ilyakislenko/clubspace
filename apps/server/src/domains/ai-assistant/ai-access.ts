// Who an ИИ-ассистент token reads the club as. A token carries no rights of its
// own: it acts as the person who created it, with the role and directions they
// hold NOW — resolved at creation and again on every MCP call, so a creator who
// was demoted, removed or blocked takes their tokens' access with them.
//
// Admin scope (owner, admin, head coach) reads the whole club. A руководитель
// направления reads only what belongs to the directions they run. Plain coaches
// and students have no ИИ-ассистент (the club's analytics are not theirs).
import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'

export const AI_ACCESS_MESSAGE =
    'ИИ-ассистент доступен администраторам клуба и руководителям направлений'

export type AiAccess = {
    workspaceId: string
    workspaceName: string
    timezone: string
    ownerId: string
    userId: string
    // The creator's role name in the club (owner without a member row: null).
    roleName: string | null
    isOwner: boolean
    // null = admin scope (every direction and club-wide rows); otherwise the
    // directions the creator runs (never empty).
    directionIds: string[] | null
}

export const resolveAiAccess = async (
    prisma: PrismaService,
    rbac: RbacService,
    p: { workspaceId: string; userId: string; now?: Date },
): Promise<AiAccess> => {
    const now = p.now ?? new Date()
    const [workspace, member] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: p.workspaceId },
            select: { name: true, timezone: true, ownerId: true },
        }),
        prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: p.userId,
                    workspaceId: p.workspaceId,
                },
            },
            select: {
                status: true,
                accessUntil: true,
                role: { select: { name: true } },
            },
        }),
    ])
    if (!workspace) throw new ForbiddenError({ message: 'Клуб не найден' })

    const isOwner = workspace.ownerId === p.userId
    if (!isOwner) {
        if (!member || member.status !== 'ACTIVE') {
            throw new ForbiddenError({ message: AI_ACCESS_MESSAGE })
        }
        if (member.accessUntil && member.accessUntil < now) {
            throw new ForbiddenError({ message: AI_ACCESS_MESSAGE })
        }
    }

    const roleName = member?.role.name ?? null
    let directionIds: string[] | null
    try {
        // Never the platform-admin bypass: handing a club's data to an AI
        // provider is the club's own decision.
        const ctx = await rbac.resolveCoachScope({
            userId: p.userId,
            workspaceId: p.workspaceId,
            roleName,
            isSuperAdmin: false,
        })
        directionIds = await rbac.assertManagesDirections(ctx)
    } catch (error) {
        if (error instanceof ForbiddenError) {
            throw new ForbiddenError({ message: AI_ACCESS_MESSAGE })
        }
        throw error
    }

    return {
        workspaceId: p.workspaceId,
        workspaceName: workspace.name,
        timezone: workspace.timezone,
        ownerId: workspace.ownerId,
        userId: p.userId,
        roleName,
        isOwner,
        directionIds,
    }
}
