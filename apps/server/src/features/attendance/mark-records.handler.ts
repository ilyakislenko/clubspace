import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
import { LeaderboardCacheService } from '../attendance-leaderboard/leaderboard-cache.service'
import { CheckInFollowUpService } from './check-in-follow-up.service'
import { syncLastAttendedAt } from './last-attended'
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
        private readonly followUps: CheckInFollowUpService,
        private readonly leaderboard: LeaderboardCacheService,
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

        let newIds: string[] = []
        let touchedSubIds: string[] = []

        await this.prisma.$transaction(async (tx) => {
            // INSERT … ON CONFLICT DO NOTHING RETURNING: only rows this call
            // actually created come back. A concurrent self check-in or another
            // coach's mark of the same member waits on the unique
            // (sessionId, userId) index and then loses here, so it is never
            // charged twice. Only a new mark consumes a class.
            const inserted = await tx.attendanceRecord.createManyAndReturn({
                data: ids.map((userId) => ({
                    sessionId: session.id,
                    workspaceId: f.workspaceId,
                    userId,
                    isGuest: guestOf(userId),
                    markedById: f.invokerUserId,
                })),
                skipDuplicates: true,
                select: { userId: true },
            })
            newIds = inserted.map((r) => r.userId)

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
            const candidates: Array<{ userId: string; subId: string }> = []
            for (const m of marked) {
                // subscriptionId outlives the pack, so this used to burn classes
                // out of an expired/cancelled one. Only a live pack is charged.
                if (!isSubscriptionUsable(m.subscription, now)) continue
                const remaining = m.subscription?.classesRemaining
                if (m.subscription && remaining != null && remaining > 0) {
                    candidates.push({
                        userId: m.userId,
                        subId: m.subscription.id,
                    })
                }
            }
            if (candidates.length > 0) {
                // Tag only packs the guarded decrement really drew from: one
                // emptied meanwhile by another check-in must not be refunded on
                // un-mark.
                const drawn = await tx.subscription.updateManyAndReturn({
                    where: {
                        id: { in: candidates.map((c) => c.subId) },
                        classesRemaining: { gt: 0 },
                    },
                    data: { classesRemaining: { decrement: 1 } },
                    select: { id: true },
                })
                const drawnIds = new Set(drawn.map((d) => d.id))
                const consumed = candidates.filter((c) => drawnIds.has(c.subId))
                if (consumed.length > 0) {
                    // One statement for the whole roster instead of one per member.
                    await tx.$executeRaw`
                        UPDATE "AttendanceRecord" AS ar
                        SET "consumedSubscriptionId" = v.sub_id
                        FROM (VALUES ${Prisma.join(
                            consumed.map(
                                (c) =>
                                    Prisma.sql`(${c.userId}::uuid, ${c.subId}::uuid)`,
                            ),
                        )}) AS v(user_id, sub_id)
                        WHERE ar."sessionId" = ${session.id}::uuid
                          AND ar."userId" = v.user_id
                    `
                }
                touchedSubIds = consumed.map((c) => c.subId)
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

        await syncLastAttendedAt(this.prisma, f.workspaceId, newIds) // inactivity-nudge input

        if (newIds.length > 0) {
            await this.leaderboard.invalidate(f.workspaceId)
            // Coach rosters and the board: merged per club so a class-start
            // burst is one refetch, not one per check-in. The marked members'
            // own attendance and abonement refresh at once, on their rooms.
            this.realtime.invalidateCoalesced(f.workspaceId, [
                'attendance',
                'leaderboard',
            ])
            this.realtime.invalidateUsersInWorkspace(newIds, f.workspaceId, [
                'attendance',
                'subscription',
            ])
            this.followUps.schedule({
                workspaceId: f.workspaceId,
                userIds: newIds,
                subscriptionIds: touchedSubIds,
            })
        }

        return buildRoster(this.prisma, session, {
            userId: ctx.userId,
            seesAllGroups: this.rbac.canSeeAllGroups(ctx),
        })
    }
}
