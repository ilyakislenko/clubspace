import { PrismaService } from '../../infrastructure/prisma'
import { memberStats } from './member-stats'

// Stats block shared by the member's own and the staff view of achievements.
// Visits are dated by the session's start (the class), not by when the coach
// marked them.
export const loadMemberStats = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    visitStarts: Date[],
    now: Date,
) => {
    const [workspace, completedSubscriptions] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        }),
        prisma.subscription.count({
            where: {
                workspaceId,
                workspaceMember: { userId },
                status: { not: 'CANCELLED' },
                startDate: { not: null },
                plan: { isFreeTrial: false },
                OR: [{ status: 'EXPIRED' }, { endDate: { lte: now } }],
            },
        }),
    ])
    return memberStats({
        visitStarts,
        completedSubscriptions,
        now,
        timezone: workspace?.timezone ?? 'Europe/Moscow',
    })
}
