import { Feature, IFeatureHandler } from '@shelfjs/features'

import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListSessionsFeature,
    ListSessionsFeatureResponse,
} from './list-sessions.feature'
import { serializeSession } from './schemas'

const DAY = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 90
const DEFAULT_WINDOW_DAYS = 30

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

        const to = f.payload.to
            ? new Date(`${f.payload.to}T23:59:59.999Z`)
            : new Date()
        const from = f.payload.from
            ? new Date(`${f.payload.from}T00:00:00Z`)
            : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY)
        if (from > to) {
            throw new BadRequestError({ message: 'from must be before to' })
        }
        if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) {
            throw new BadRequestError({
                message: `Date range must be at most ${MAX_RANGE_DAYS} days`,
            })
        }

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
