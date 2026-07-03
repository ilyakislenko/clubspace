import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { resolveDateWindow } from './attendance-utils'
import {
    GetMyAttendanceFeature,
    GetMyAttendanceFeatureResponse,
} from './get-my-attendance.feature'
import { serializeSession } from './schemas'

@Feature(GetMyAttendanceFeature)
export class GetMyAttendanceHandler
    implements
        IFeatureHandler<GetMyAttendanceFeature, GetMyAttendanceFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyAttendanceFeature) {
        const { from, to, error } = resolveDateWindow(
            f.payload.from,
            f.payload.to,
            { defaultDays: 30, maxDays: 90 },
        )
        if (error) throw new BadRequestError({ message: error })

        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20
        const rangeWhere = {
            workspaceId: f.workspaceId,
            userId: f.userId,
            markedAt: { gte: from, lte: to },
        }

        const [records, rangeCount, total] = await Promise.all([
            this.prisma.attendanceRecord.findMany({
                where: rangeWhere,
                include: {
                    session: {
                        include: { _count: { select: { records: true } } },
                    },
                },
                orderBy: { markedAt: 'desc' },
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.attendanceRecord.count({ where: rangeWhere }),
            this.prisma.attendanceRecord.count({
                where: { workspaceId: f.workspaceId, userId: f.userId },
            }),
        ])

        return {
            sessions: records.map((r) => serializeSession(r.session)),
            total,
            rangeCount,
            curPage,
            perPage,
        }
    }
}
