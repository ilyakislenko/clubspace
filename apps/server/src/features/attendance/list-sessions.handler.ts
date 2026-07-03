import { Feature, IFeatureHandler } from '@shelfjs/features'

import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveDateWindow } from './attendance-utils'
import {
    ListSessionsFeature,
    ListSessionsFeatureResponse,
} from './list-sessions.feature'
import { serializeSession } from './schemas'

@Feature(ListSessionsFeature)
export class ListSessionsHandler
    implements IFeatureHandler<ListSessionsFeature, ListSessionsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListSessionsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const { from, to, error } = resolveDateWindow(
            f.payload.from,
            f.payload.to,
            { defaultDays: 30, maxDays: 90 },
        )
        if (error) throw new BadRequestError({ message: error })

        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20

        const where: Prisma.AttendanceSessionWhereInput = {
            workspaceId: f.workspaceId,
            startAt: { gte: from, lte: to },
            ...(f.payload.groupId ? { groupId: f.payload.groupId } : {}),
            // Coaches without see-all scope only see their own groups'
            // sessions (event sessions have no group, so are excluded).
            ...(this.rbac.canSeeAllGroups(ctx)
                ? {}
                : { group: { coaches: { some: { userId: ctx.userId } } } }),
        }

        const [rows, total] = await Promise.all([
            this.prisma.attendanceSession.findMany({
                where,
                include: { _count: { select: { records: true } } },
                orderBy: { startAt: 'desc' },
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.attendanceSession.count({ where }),
        ])

        return {
            data: rows.map(serializeSession),
            total,
            curPage,
            perPage,
        }
    }
}
