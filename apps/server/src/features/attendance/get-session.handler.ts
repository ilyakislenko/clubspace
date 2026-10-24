import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetAttendanceSessionFeature,
    GetAttendanceSessionFeatureResponse,
} from './get-session.feature'
import { serializeSession } from './schemas'
import { loadSessionForRead } from './session-access'

@Feature(GetAttendanceSessionFeature)
export class GetAttendanceSessionHandler
    implements
        IFeatureHandler<
            GetAttendanceSessionFeature,
            GetAttendanceSessionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetAttendanceSessionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForRead(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )
        const row = await this.prisma.attendanceSession.findUniqueOrThrow({
            where: { id: session.id },
            include: { _count: { select: { records: true } } },
        })
        return serializeSession(row)
    }
}
