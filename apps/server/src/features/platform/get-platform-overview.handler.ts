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

        const [
            workspaceCount,
            activeWorkspaceCount,
            userCount,
            activeMembershipCount,
            platformAdminCount,
            billingByStatus,
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
        ])
        const countOf = (status: string) =>
            billingByStatus.find((row) => row.status === status)?._count._all ?? 0

        return {
            workspaceCount,
            activeWorkspaceCount,
            userCount,
            activeMembershipCount,
            platformAdminCount,
            trialWorkspaceCount: countOf('TRIAL'),
            pastDueWorkspaceCount: countOf('PAST_DUE'),
            suspendedWorkspaceCount: countOf('SUSPENDED'),
        }
    }
}
