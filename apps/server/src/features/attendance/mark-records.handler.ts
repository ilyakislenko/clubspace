import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
import { LeaderboardCacheService } from '../attendance-leaderboard/leaderboard-cache.service'
import { localDateInTz } from './attendance-utils'
import { CheckInFollowUpService } from './check-in-follow-up.service'
import { markClassBookingsAttended } from './class-booking-marks'
import { syncLastAttendedAt } from './last-attended'
import {
    MarkRecordsFeature,
    MarkRecordsFeatureResponse,
} from './mark-records.feature'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'
import {
    chargeVisits,
    loadSessionVisitOptions,
    VISIT_ABONEMENT_REFUSED_MESSAGE,
    type SessionVisitOptions,
} from './session-visits'

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
            select: { ownerId: true, timezone: true },
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
        const now = new Date()
        const overrides = new Map(
            (f.payload.abonements ?? []).map((a) => [a.userId, a.subscriptionId]),
        )

        await this.prisma.$transaction(async (tx) => {
            // Which abonement each member's visit may be spent on. Personal
            // sessions never touch abonements (paid off-app: never draw a
            // group class pack).
            let visits: SessionVisitOptions | null = null
            if (!session.isPersonal) {
                visits = await loadSessionVisitOptions(tx, {
                    workspaceId: f.workspaceId,
                    sessionId: session.id,
                    // Freezes are club-calendar days, like the roster badge.
                    dayYmd: localDateInTz(
                        session.startAt,
                        workspace?.timezone ?? 'UTC',
                    ),
                    userIds: ids,
                    now,
                })
                // A chosen abonement must be one this member may spend on
                // this class — checked before anything is written.
                for (const [userId, subscriptionId] of overrides) {
                    const ranked = visits.ranked.get(userId) ?? []
                    if (
                        !ids.includes(userId) ||
                        !ranked.some((c) => c.id === subscriptionId)
                    ) {
                        throw new BadRequestError({
                            message: VISIT_ABONEMENT_REFUSED_MESSAGE,
                        })
                    }
                }
            }

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
            // «Запись на занятие»: their bookings of this class read «пришёл».
            if (newIds.length > 0 && session.slotId) {
                await markClassBookingsAttended(tx, {
                    workspaceId: f.workspaceId,
                    occurrenceKey: session.occurrenceKey,
                    userIds: newIds,
                })
            }

            if (newIds.length === 0 || !visits) return
            const ranked = visits.ranked
            // Each visit goes to the chosen abonement or the precedence's
            // first; running out never blocks the mark (no eligible one = an
            // unattributed visit). The record keeps the pack it drew from so
            // un-marking refunds exactly what it deducted.
            const charges = await chargeVisits(
                tx,
                session.id,
                newIds.map((userId) => {
                    const options = ranked.get(userId) ?? []
                    const chosen = overrides.get(userId)
                    return {
                        userId,
                        options: chosen
                            ? [
                                  ...options.filter((c) => c.id === chosen),
                                  ...options.filter((c) => c.id !== chosen),
                              ]
                            : options,
                    }
                }),
            )
            touchedSubIds = charges.flatMap((c) =>
                c.consumedId ? [c.consumedId] : [],
            )
            // A «с первой тренировки» abonement starts on its first visit.
            for (const userId of newIds) {
                if (
                    !visits.candidates
                        .get(userId)
                        ?.some((c) => c.startsOnFirstVisit)
                ) {
                    continue
                }
                await syncFirstVisitStartInTx(tx, {
                    workspaceId: f.workspaceId,
                    userId,
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
