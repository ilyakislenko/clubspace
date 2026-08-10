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

        // The owner is allowed with no member row.
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

        let guestOf: (userId: string) => boolean | null = () => null
        if (session.groupId) {
            const gm = await this.prisma.groupMember.findMany({
                where: { groupId: session.groupId, userId: { in: ids } },
                select: { userId: true },
            })
            const inGroup = new Set(gm.map((g) => g.userId))
            guestOf = (userId: string) => !inGroup.has(userId)
        }

        // Only a new mark consumes a class; a re-mark must not.
        const existing = await this.prisma.attendanceRecord.findMany({
            where: { sessionId: session.id, userId: { in: ids } },
            select: { userId: true },
        })
        const already = new Set(existing.map((r) => r.userId))
        const newIds = ids.filter((id) => !already.has(id))

        let touchedSubIds: string[] = []

        await this.prisma.$transaction(async (tx) => {
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
            // Running out never blocks access; time-only subs have
            // classesRemaining = null and are skipped. Each check-in records the
            // pack it drew from so un-marking refunds exactly what it deducted.
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
                // subscriptionId outlives the pack, so this used to burn classes
                // out of an expired/cancelled one. Only a live pack is charged.
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
                for (const c of consumed) {
                    await tx.attendanceRecord.updateMany({
                        where: { sessionId: session.id, userId: c.userId },
                        data: { consumedSubscriptionId: c.subId },
                    })
                }
                touchedSubIds = subIds
            }
        })

        this.realtime.invalidate(f.workspaceId, [
            'attendance',
            'leaderboard',
            'subscription',
        ])

        // Deduped per (subscription, level).
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
                    workspaceId: f.workspaceId,
                    feature: 'subscription',
                })
            }
        }

        // Best-effort; each notifier call swallows its own errors.
        for (const userId of newIds) {
            await this.achievements.notifyUnlocked(userId, f.workspaceId)
        }

        return buildRoster(this.prisma, session)
    }
}
