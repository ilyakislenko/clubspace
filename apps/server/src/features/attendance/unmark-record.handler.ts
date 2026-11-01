import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { LeaderboardCacheService } from '../attendance-leaderboard/leaderboard-cache.service'
import { unmarkClassBooking } from './class-booking-marks'
import { syncLastAttendedAt } from './last-attended'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'
import { refundConsumedClass } from './session-visits'
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
        private readonly leaderboard: LeaderboardCacheService,
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
            // The visit's attribution (usedSubscriptionId) goes with the row.
            const deleted = await tx.attendanceRecord.deleteMany({
                where: { sessionId: session.id, userId: f.userId },
            })
            if (deleted.count === 0) return false

            // Un-marking the first visit un-starts a «с первой тренировки»
            // abonement (or moves its start to the next remaining visit).
            await syncFirstVisitStartInTx(tx, {
                workspaceId: f.workspaceId,
                userId: f.userId,
                now: new Date(),
            })
            if (record?.consumedSubscriptionId) {
                await refundConsumedClass(tx, record.consumedSubscriptionId)
            }
            if (session.slotId) {
                await unmarkClassBooking(tx, {
                    workspaceId: f.workspaceId,
                    occurrenceKey: session.occurrenceKey,
                    userId: f.userId,
                })
            }
            return true
        })

        if (refunded) {
            await syncLastAttendedAt(this.prisma, f.workspaceId, [f.userId]) // inactivity-nudge input
            await this.leaderboard.invalidate(f.workspaceId)
            this.realtime.invalidateCoalesced(f.workspaceId, [
                'attendance',
                'leaderboard',
            ])
            this.realtime.invalidateUsersInWorkspace([f.userId], f.workspaceId, [
                'attendance',
                'subscription',
            ])
        }

        return buildRoster(this.prisma, session, {
            userId: ctx.userId,
            seesAllGroups: this.rbac.canSeeAllGroups(ctx),
        })
    }
}
