import { Feature, IFeatureHandler } from '@shelfjs/features'

import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetAttendanceOverviewFeature,
    GetAttendanceOverviewFeatureResponse,
} from './get-overview.feature'

const DAY = 24 * 60 * 60 * 1000

@Feature(GetAttendanceOverviewFeature)
export class GetAttendanceOverviewHandler
    implements
        IFeatureHandler<
            GetAttendanceOverviewFeature,
            GetAttendanceOverviewFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetAttendanceOverviewFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const days = f.payload.days ?? 30
        const now = new Date()
        const since = new Date(now.getTime() - days * DAY)
        const ownGroups = !this.rbac.canSeeAllGroups(ctx)
            ? { coaches: { some: { userId: ctx.userId } } }
            : undefined

        const sessionWhere: Prisma.AttendanceSessionWhereInput = {
            workspaceId: f.workspaceId,
            // Sessions opened ahead of time (personal ones) are not held yet.
            startAt: { gte: since, lte: now },
            ...(ownGroups ? { group: ownGroups } : {}),
        }
        const recordWhere: Prisma.AttendanceRecordWhereInput = {
            workspaceId: f.workspaceId,
            markedAt: { gte: since },
            ...(ownGroups ? { session: { group: ownGroups } } : {}),
        }

        const [sessionsHeld, totalCheckIns, distinct] = await Promise.all([
            this.prisma.attendanceSession.count({ where: sessionWhere }),
            this.prisma.attendanceRecord.count({ where: recordWhere }),
            this.prisma.attendanceRecord.findMany({
                where: recordWhere,
                distinct: ['userId'],
                select: { userId: true },
            }),
        ])

        return {
            days,
            sessionsHeld,
            totalCheckIns,
            distinctAttendees: distinct.length,
        }
    }
}
