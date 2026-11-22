// Who an ИИ-ассистент token reads the club as. A token carries no rights of its
// own: it acts as the person who created it, with the role and directions they
// hold NOW — resolved at creation and again on every MCP call, so a creator who
// was demoted, removed or blocked takes their tokens' access with them.
//
// Sport leads (owner, admin, head coach) read the whole club. A руководитель
// направления reads only what belongs to the directions they run. Plain coaches
// and students have no ИИ-ассистент (the club's analytics are not theirs).
// Club money (revenue, debts, amounts paid) and the ИИ-токены for outside
// assistants are for club admins only (owner, admin): a head coach or a
// direction manager talks to the in-app chat without the money tools.
import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'

export const AI_ACCESS_MESSAGE =
    'ИИ-ассистент доступен руководству клуба и руководителям направлений'

export const AI_TOKEN_ACCESS_MESSAGE =
    'ИИ-токены выдают владелец и администраторы клуба'

export type AiAccess = {
    workspaceId: string
    workspaceName: string
    timezone: string
    ownerId: string
    userId: string
    // The creator's role name in the club (owner without a member row: null).
    roleName: string | null
    isOwner: boolean
    // Owner or admin: sees club money and may hold ИИ-токены.
    isClubAdmin: boolean
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
        isClubAdmin: isOwner || roleName === 'admin',
        directionIds,
    }
}

// ИИ-токены (Интеграции, MCP) are a system setting: the owner and admins only.
// Checked on every token route and every MCP call, so a creator demoted below
// admin takes their tokens' access with them.
export const assertAiTokenManager = (access: AiAccess): void => {
    if (!access.isClubAdmin) {
        throw new ForbiddenError({ message: AI_TOKEN_ACCESS_MESSAGE })
    }
}
