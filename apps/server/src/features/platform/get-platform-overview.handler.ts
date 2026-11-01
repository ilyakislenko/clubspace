import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    GetPlatformOverviewFeature,
    GetPlatformOverviewFeatureResponse,
} from './get-platform-overview.feature'

@Feature(GetPlatformOverviewFeature)
export class GetPlatformOverviewHandler
    implements
        IFeatureHandler<
            GetPlatformOverviewFeature,
            GetPlatformOverviewFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetPlatformOverviewFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const now = new Date()
        const [
            workspaceCount,
            activeWorkspaceCount,
            userCount,
            activeMembershipCount,
            platformAdminCount,
            billingByStatus,
            trialsStarted,
            trialsRunning,
            converted,
            decided,
            averageRows,
            openOnboardingRequestCount,
        ] = await Promise.all([
            this.prisma.workspace.count(),
            this.prisma.workspace.count({ where: { isActive: true } }),
            this.prisma.user.count({ where: { deletedAt: null } }),
            this.prisma.workspaceMember.count({ where: { status: 'ACTIVE' } }),
            this.prisma.user.count({
                where: { isSuperAdmin: true, deletedAt: null },
            }),
            this.prisma.workspaceBilling.groupBy({
                by: ['status'],
                _count: { _all: true },
            }),
            // Every billing row starts as a trial (createdAt = its start).
            this.prisma.workspaceBilling.count(),
            this.prisma.workspaceBilling.count({
                where: { status: 'TRIAL', trialEndsAt: { gt: now }, convertedAt: null },
            }),
            this.prisma.workspaceBilling.count({ where: { convertedAt: { not: null } } }),
            this.prisma.workspaceBilling.count({
                where: {
                    OR: [{ convertedAt: { not: null } }, { trialEndsAt: { lte: now } }],
                },
            }),
            this.prisma.$queryRaw<{ days: number | null }[]>`
                SELECT AVG(EXTRACT(EPOCH FROM ("convertedAt" - "createdAt")) / 86400)::float8 AS days
                FROM "WorkspaceBilling"
                WHERE "convertedAt" IS NOT NULL
            `,
            this.prisma.onboardingHelpRequest.count({ where: { status: 'OPEN' } }),
        ])
        const countOf = (status: string) =>
            billingByStatus.find((row) => row.status === status)?._count._all ?? 0
        const averageDays = averageRows[0]?.days ?? null

        return {
            workspaceCount,
            activeWorkspaceCount,
            userCount,
            activeMembershipCount,
            platformAdminCount,
            trialWorkspaceCount: countOf('TRIAL'),
            pastDueWorkspaceCount: countOf('PAST_DUE'),
            suspendedWorkspaceCount: countOf('SUSPENDED'),
            trials: {
                started: trialsStarted,
                running: trialsRunning,
                converted,
                conversionPercent:
                    decided > 0 ? Math.round((converted / decided) * 1000) / 10 : null,
                averageDaysToConvert:
                    averageDays === null ? null : Math.round(averageDays * 10) / 10,
            },
            openOnboardingRequestCount,
        }
    }
}
