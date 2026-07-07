import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'
import {
    UnmarkRecordFeature,
    UnmarkRecordFeatureResponse,
} from './unmark-record.feature'

@Feature(UnmarkRecordFeature)
export class UnmarkRecordHandler
    implements
        IFeatureHandler<UnmarkRecordFeature, UnmarkRecordFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UnmarkRecordFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        // deleteMany so un-marking a not-present user is a no-op success.
        const deleted = await this.prisma.attendanceRecord.deleteMany({
            where: { sessionId: session.id, userId: f.userId },
        })

        // Refund the class only if a mark was actually removed, and only up to
        // the pack size (never above classesTotal; time-only subs are skipped).
        if (deleted.count > 0) {
            const member = await this.prisma.workspaceMember.findFirst({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: {
                    subscription: {
                        select: {
                            id: true,
                            classesRemaining: true,
                            classesTotal: true,
                        },
                    },
                },
            })
            const sub = member?.subscription
            if (
                sub &&
                sub.classesRemaining != null &&
                sub.classesTotal != null &&
                sub.classesRemaining < sub.classesTotal
            ) {
                await this.prisma.subscription.update({
                    where: { id: sub.id },
                    data: { classesRemaining: { increment: 1 } },
                })
            }
            this.realtime.invalidate(f.workspaceId, [
                'attendance',
                'leaderboard',
                'subscription',
            ])
        }

        return buildRoster(this.prisma, session)
    }
}
