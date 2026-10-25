import { PrismaService } from '../../infrastructure/prisma'
import { memberStats } from './member-stats'

// Completed abonements of a member: time-based ones that ran out (or were
// expired) and class packs that were used up. Free trials and never-started
// or cancelled ones don't count.
export const countCompletedSubscriptions = (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    now: Date,
) =>
    prisma.subscription.count({
        where: {
            workspaceId,
            workspaceMember: { userId },
            status: { not: 'CANCELLED' },
            startDate: { not: null },
            plan: { isFreeTrial: false },
            OR: [
                { status: 'EXPIRED' },
                { endDate: { lte: now } },
                { classesTotal: { not: null }, classesRemaining: { lte: 0 } },
            ],
        },
    })

// Stats block shared by the member's own and the staff view of achievements.
// Visits are dated by the session's start (the class), not by when the coach
// marked them.
export const buildMemberStats = (
    visits: { startAt: Date; timezone: string }[],
    completedSubscriptions: number,
    now: Date,
) => memberStats({ visits, completedSubscriptions, now })
