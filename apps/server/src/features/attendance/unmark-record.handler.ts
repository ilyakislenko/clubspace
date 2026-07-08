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

        // Read the record's consumed-pack tag, delete it, and refund that exact
        // pack — all atomically. Refunding only what the check-in actually
        // deducted (consumedSubscriptionId) means training past an exhausted
        // pack, or a later pack change, can't be un-marked into a free class.
        const refunded = await this.prisma.$transaction(async (tx) => {
            const record = await tx.attendanceRecord.findUnique({
                where: {
                    sessionId_userId: {
                        sessionId: session.id,
                        userId: f.userId,
                    },
                },
                select: { consumedSubscriptionId: true },
            })
            // deleteMany so un-marking a not-present user is a no-op success.
            const deleted = await tx.attendanceRecord.deleteMany({
                where: { sessionId: session.id, userId: f.userId },
            })
            if (deleted.count === 0 || !record?.consumedSubscriptionId) {
                return deleted.count > 0
            }

            const sub = await tx.subscription.findUnique({
                where: { id: record.consumedSubscriptionId },
                select: { id: true, classesRemaining: true, classesTotal: true },
            })
            // Clamp at the pack size — never refund above classesTotal.
            if (
                sub &&
                sub.classesRemaining != null &&
                sub.classesTotal != null &&
                sub.classesRemaining < sub.classesTotal
            ) {
                await tx.subscription.update({
                    where: { id: sub.id },
                    data: { classesRemaining: { increment: 1 } },
                })
            }
            return true
        })

        if (refunded) {
            this.realtime.invalidate(f.workspaceId, [
                'attendance',
                'leaderboard',
                'subscription',
            ])
        }

        return buildRoster(this.prisma, session)
    }
}
