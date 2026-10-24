import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import { findFreezeOn } from '../../domains/subscriptions/services/subscription-freeze.service'
import { ClassPackNotifierService } from '../../domains/subscriptions/services/class-pack-notifier.service'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { localDateInTz } from '../attendance/attendance-utils'
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
    private readonly logger = new Logger(SelfCheckInHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
        private readonly achievements: AchievementNotifierService,
        private readonly classPacks: ClassPackNotifierService,
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

        const membership = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId },
            select: {
                status: true,
                workspace: { select: { timezone: true } },
                subscription: {
                    select: {
                        id: true,
                        classesRemaining: true,
                        startsOnFirstVisit: true,
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

        // A frozen abonement is paused, not used: the member has to ask the club
        // to end the freeze first. Coach marking stays allowed (the member did
        // attend), so this is the only entry point that refuses. The day checked
        // is the session's own day on the club calendar, matching the roster badge.
        if (sub) {
            const frozen = await findFreezeOn(this.prisma, {
                subscriptionId: sub.id,
                dayYmd: localDateInTz(
                    session.startAt,
                    membership.workspace.timezone,
                ),
            })
            if (frozen) {
                throw new BadRequestError({
                    message: `Абонемент заморожен по ${formatRuDate(frozen.untilDate, 'UTC')}. Чтобы отметиться, попросите тренера или администратора клуба снять заморозку.`,
                })
            }
        }

        let classesRemaining = sub?.classesRemaining ?? null
        let deductedFrom: string | null = null

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
                deductedFrom = sub.id
            }
            // A «с первой тренировки» abonement starts on its first check-in.
            if (sub?.startsOnFirstVisit) {
                await syncFirstVisitStartInTx(tx, {
                    workspaceId,
                    userId,
                    now: new Date(),
                })
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
            // Same low / used-up pack alert coach marking sends. Best-effort:
            // the check-in is already committed, so a failed push must not
            // turn it into an error for the student.
            if (deductedFrom) {
                try {
                    await this.classPacks.notifyLowOrExhausted(
                        [deductedFrom],
                        workspaceId,
                    )
                } catch (err) {
                    this.logger.warn(
                        `Class-pack alert failed after check-in: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    )
                }
            }
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
