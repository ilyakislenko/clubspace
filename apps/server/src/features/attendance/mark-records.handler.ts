import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import { ClassPackNotifierService } from '../../domains/subscriptions/services/class-pack-notifier.service'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
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
        private readonly classPacks: ClassPackNotifierService,
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

        // A personal session has exactly one attendee: the request's member.
        if (session.isPersonal) {
            const request = await this.prisma.personalTrainingRequest.findUnique({
                where: { sessionId: session.id },
                select: { memberId: true },
            })
            if (ids.some((id) => id !== request?.memberId)) {
                throw new BadRequestError({
                    message:
                        'На персональной тренировке можно отметить только ученика из заявки',
                })
            }
        }

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
            // Coaches see this text: names, never raw ids.
            const users = await this.prisma.user.findMany({
                where: { id: { in: unknown } },
                select: { id: true, firstname: true, lastname: true },
            })
            const byId = new Map(users.map((u) => [u.id, u]))
            const names = unknown.map((id) =>
                nameOrPlaceholder(
                    byId.get(id) ?? { firstname: null, lastname: null },
                ),
            )
            throw new BadRequestError({
                message: `Не состоят в клубе: ${names.join(', ')}`,
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
            // personal sessions never touch abonements
            // (paid off-app: never draw a group class pack)
            if (session.isPersonal) return
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
                            startsOnFirstVisit: true,
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
            // A «с первой тренировки» abonement starts on its first mark.
            for (const m of marked) {
                if (!m.subscription?.startsOnFirstVisit) continue
                await syncFirstVisitStartInTx(tx, {
                    workspaceId: f.workspaceId,
                    userId: m.userId,
                    now,
                })
            }
        })

        this.realtime.invalidate(f.workspaceId, [
            'attendance',
            'leaderboard',
            'subscription',
        ])

        await this.classPacks.notifyLowOrExhausted(touchedSubIds, f.workspaceId)

        // Best-effort; each achievement notifier call swallows its own errors.
        for (const userId of newIds) {
            await this.achievements.notifyUnlocked(userId, f.workspaceId)
        }

        return buildRoster(this.prisma, session, {
            userId: ctx.userId,
            seesAllGroups: this.rbac.canSeeAllGroups(ctx),
        })
    }
}
