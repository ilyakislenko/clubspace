import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { AchievementNotifierService } from '../get-my-achievements/achievement-notifier.service'
import {
    SelfCheckInFeature,
    SelfCheckInFeatureResponse,
} from './self-check-in.feature'

// A code only matches a session happening around now, so an old code can't be
// reused for an old session.
const CODE_WINDOW_MS = 12 * 60 * 60 * 1000

@Feature(SelfCheckInFeature)
export class SelfCheckInHandler
    implements IFeatureHandler<SelfCheckInFeature, SelfCheckInFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
        private readonly achievements: AchievementNotifierService,
    ) {}

    async execute({ payload, workspaceId, userId }: SelfCheckInFeature) {
        const code = payload.code.trim().toUpperCase()
        const now = new Date()

        const session = await this.prisma.attendanceSession.findFirst({
            where: {
                workspaceId,
                checkInCode: code,
                startAt: {
                    gte: new Date(now.getTime() - CODE_WINDOW_MS),
                    lte: new Date(now.getTime() + CODE_WINDOW_MS),
                },
            },
            orderBy: { startAt: 'desc' },
            select: { id: true, title: true, startAt: true, groupId: true },
        })
        if (!session) {
            throw new BadRequestError({
                message: 'Код не найден или занятие уже прошло',
            })
        }

        // Must be an active member of this workspace.
        const membership = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId },
            select: {
                status: true,
                subscription: {
                    select: {
                        id: true,
                        classesRemaining: true,
                        ...subscriptionUsabilitySelect,
                    },
                },
            },
        })
        if (!membership || membership.status !== MemberStatus.ACTIVE) {
            throw new ForbiddenError({
                message: 'Только активные участники могут отмечаться',
            })
        }

        // Guest = not in the session's group (event sessions have no group).
        let isGuest: boolean | null = null
        if (session.groupId) {
            const inGroup = await this.prisma.groupMember.findFirst({
                where: { groupId: session.groupId, userId },
                select: { userId: true },
            })
            isGuest = !inGroup
        }

        // Same rule as coach-marking: the membership keeps pointing at a pack
        // after it expires or is cancelled, and burning a class out of a dead
        // one takes balance the member can never spend.
        const sub = isSubscriptionUsable(membership.subscription)
            ? membership.subscription
            : null
        let classesRemaining = sub?.classesRemaining ?? null

        const checkedIn = await this.prisma.$transaction(async (tx) => {
            const inserted = await tx.attendanceRecord.createMany({
                data: [
                    {
                        sessionId: session.id,
                        workspaceId,
                        userId,
                        isGuest,
                        markedById: userId,
                    },
                ],
                skipDuplicates: true,
            })
            if (inserted.count === 0) return false // already checked in

            // Deduct one class from an active pack (>0), tagging the check-in
            // with the exact pack so an un-mark refunds precisely it — same rule
            // as coach marking.
            if (sub && sub.classesRemaining != null && sub.classesRemaining > 0) {
                await tx.subscription.updateMany({
                    where: { id: sub.id, classesRemaining: { gt: 0 } },
                    data: { classesRemaining: { decrement: 1 } },
                })
                await tx.attendanceRecord.updateMany({
                    where: { sessionId: session.id, userId },
                    data: { consumedSubscriptionId: sub.id },
                })
                classesRemaining = sub.classesRemaining - 1
            }
            return true
        })

        if (checkedIn) {
            // Coach roster + leaderboard (workspace), the member's own
            // attendance + subscription (user-scoped caches).
            this.realtime.invalidate(workspaceId, ['attendance', 'leaderboard'])
            this.realtime.invalidateUsers(
                [userId],
                ['attendance', 'subscription'],
            )
            // Celebrate any achievement this check-in just unlocked (best-effort).
            await this.achievements.notifyUnlocked(userId, workspaceId)
        }

        return {
            sessionId: session.id,
            sessionTitle: session.title,
            startAt: session.startAt.toISOString(),
            checkedIn,
            classesRemaining,
        }
    }
}
