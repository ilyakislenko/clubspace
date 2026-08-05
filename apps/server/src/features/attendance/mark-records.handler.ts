import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { AchievementNotifierService } from '../get-my-achievements/achievement-notifier.service'
import {
    MarkRecordsFeature,
    MarkRecordsFeatureResponse,
} from './mark-records.feature'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'

@Feature(MarkRecordsFeature)
export class MarkRecordsHandler
    implements IFeatureHandler<MarkRecordsFeature, MarkRecordsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
        private readonly achievements: AchievementNotifierService,
    ) {}

    async execute(f: MarkRecordsFeature) {
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

        const ids = [...new Set(f.payload.userIds)]

        // (1) Validate ACTIVE membership; the owner is allowed with no member row.
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                userId: { in: ids },
            },
            select: { userId: true },
        })
        const allowed = new Set(members.map((m) => m.userId))
        if (workspace?.ownerId) allowed.add(workspace.ownerId)
        const unknown = ids.filter((id) => !allowed.has(id))
        if (unknown.length) {
            throw new BadRequestError({
                message: `Не активные участники клуба: ${unknown.join(', ')}`,
            })
        }

        // (2) isGuest per user (group sessions only; null for events).
        let guestOf: (userId: string) => boolean | null = () => null
        if (session.groupId) {
            const gm = await this.prisma.groupMember.findMany({
                where: { groupId: session.groupId, userId: { in: ids } },
                select: { userId: true },
            })
            const inGroup = new Set(gm.map((g) => g.userId))
            guestOf = (userId: string) => !inGroup.has(userId)
        }

        // (3) Which of these are NEW marks (not already recorded)? Only a new
        // mark consumes a class from the member's pack — a re-mark must not.
        const existing = await this.prisma.attendanceRecord.findMany({
            where: { sessionId: session.id, userId: { in: ids } },
            select: { userId: true },
        })
        const already = new Set(existing.map((r) => r.userId))
        const newIds = ids.filter((id) => !already.has(id))

        // Subscriptions whose balance we decremented — checked for a low-balance
        // nudge after the transaction commits.
        let touchedSubIds: string[] = []

        await this.prisma.$transaction(async (tx) => {
            // Insert; a re-mark is a no-op (skipDuplicates).
            await tx.attendanceRecord.createMany({
                data: ids.map((userId) => ({
                    sessionId: session.id,
                    workspaceId: f.workspaceId,
                    userId,
                    isGuest: guestOf(userId),
                    markedById: f.invokerUserId,
                })),
                skipDuplicates: true,
            })

            if (newIds.length === 0) return
            // Deduct one class from each newly-marked member's active class-pack
            // — but only when it actually has classes left (running out never
            // blocks access; time-only subs have classesRemaining = null and are
            // skipped). Each consumed check-in is tagged with the exact pack it
            // drew from, so un-marking refunds precisely what it deducted (and
            // training past an exhausted pack can't be un-marked into a free
            // class).
            const marked = await tx.workspaceMember.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    userId: { in: newIds },
                    subscriptionId: { not: null },
                },
                select: {
                    userId: true,
                    subscription: {
                        select: {
                            id: true,
                            classesRemaining: true,
                            ...subscriptionUsabilitySelect,
                        },
                    },
                },
            })
            const now = new Date()
            const consumed: Array<{ userId: string; subId: string }> = []
            for (const m of marked) {
                // The membership's subscriptionId keeps pointing at a pack that
                // has expired or been cancelled, so this used to burn classes
                // out of a dead abonement — the member lost balance they could
                // never spend. Only a live one is charged.
                if (!isSubscriptionUsable(m.subscription, now)) continue
                const remaining = m.subscription?.classesRemaining
                if (m.subscription && remaining != null && remaining > 0) {
                    consumed.push({ userId: m.userId, subId: m.subscription.id })
                }
            }
            if (consumed.length > 0) {
                const subIds = consumed.map((c) => c.subId)
                await tx.subscription.updateMany({
                    where: { id: { in: subIds }, classesRemaining: { gt: 0 } },
                    data: { classesRemaining: { decrement: 1 } },
                })
                // Tag each consumed check-in with the pack it drew from.
                for (const c of consumed) {
                    await tx.attendanceRecord.updateMany({
                        where: { sessionId: session.id, userId: c.userId },
                        data: { consumedSubscriptionId: c.subId },
                    })
                }
                touchedSubIds = subIds
            }
        })

        // Live-refresh members' attendance, the leaderboard, and — since a pack
        // balance changed — their subscription screen.
        this.realtime.invalidate(f.workspaceId, [
            'attendance',
            'leaderboard',
            'subscription',
        ])

        // Nudge members whose pack just dropped to its last class or ran out, so
        // they buy a new abonement. Deduped per (subscription, level).
        if (touchedSubIds.length > 0) {
            const low = await this.prisma.subscription.findMany({
                where: {
                    id: { in: touchedSubIds },
                    classesRemaining: { in: [0, 1] },
                },
                select: {
                    id: true,
                    classesRemaining: true,
                    workspaceMember: { select: { userId: true } },
                },
            })
            for (const s of low) {
                const userId = s.workspaceMember?.userId
                if (!userId) continue
                const out = s.classesRemaining === 0
                await this.notifications.notifyUser({
                    userId,
                    kind: out ? 'classes.exhausted' : 'classes.low',
                    refId: `${s.id}:${s.classesRemaining}`,
                    topic: out ? 'Занятия закончились' : 'Осталось 1 занятие',
                    message: out
                        ? 'Абонемент израсходован. Оформите новый, чтобы продолжить ходить на тренировки.'
                        : 'На вашем абонементе осталось последнее занятие.',
                    metadata: { subscriptionId: s.id },
                    category: 'accessExpiringEnabled',
                    // Skip if the club hid the Subscription section from the app.
                    workspaceId: f.workspaceId,
                    feature: 'subscription',
                })
            }
        }

        // Celebrate achievements the newly-marked members just unlocked
        // (best-effort; each notifier call swallows its own errors).
        for (const userId of newIds) {
            await this.achievements.notifyUnlocked(userId, f.workspaceId)
        }

        return buildRoster(this.prisma, session)
    }
}
