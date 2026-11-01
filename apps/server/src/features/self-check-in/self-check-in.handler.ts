import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import {
    toVisitAbonement,
    type VisitAbonement,
} from '../../domains/subscriptions/visit-abonement'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { LeaderboardCacheService } from '../attendance-leaderboard/leaderboard-cache.service'
import { CheckInFollowUpService } from '../attendance/check-in-follow-up.service'
import { syncLastAttendedAt } from '../attendance/last-attended'
import {
    chargeVisits,
    exhaustedPackCovers,
    loadUsedAbonements,
    VISIT_ABONEMENT_REFUSED_MESSAGE,
    type VisitCharge,
} from '../attendance/session-visits'
import { loadSelfCheckInSession } from './self-check-in-session'
import {
    SelfCheckInFeature,
    SelfCheckInFeatureResponse,
} from './self-check-in.feature'

@Feature(SelfCheckInFeature)
export class SelfCheckInHandler
    implements IFeatureHandler<SelfCheckInFeature, SelfCheckInFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
        private readonly followUps: CheckInFollowUpService,
        private readonly leaderboard: LeaderboardCacheService,
    ) {}

    async execute({ payload, workspaceId, userId }: SelfCheckInFeature) {
        const now = new Date()
        const { session, visits, candidates, ranked } =
            await loadSelfCheckInSession(this.prisma, {
                workspaceId,
                userId,
                code: payload.code,
                now,
            })

        // The member may pick another eligible abonement than the default.
        let options = ranked
        if (payload.subscriptionId) {
            const chosen = ranked.find((c) => c.id === payload.subscriptionId)
            if (!chosen) {
                throw new BadRequestError({
                    message: VISIT_ABONEMENT_REFUSED_MESSAGE,
                })
            }
            options = [chosen, ...ranked.filter((c) => c !== chosen)]
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

        const result = await this.prisma.$transaction(
            async (tx): Promise<{ charge: VisitCharge | null } | null> => {
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
                if (inserted.count === 0) return null // already checked in

                // Same rule as coach marking: the visit goes to the chosen /
                // first eligible abonement (a pack is decremented with the
                // guarded update and tagged so an un-mark refunds precisely it).
                const [spent] = await chargeVisits(tx, session.id, [
                    { userId, options },
                ])
                // A «с первой тренировки» abonement starts on its first check-in.
                if (candidates.some((c) => c.startsOnFirstVisit)) {
                    await syncFirstVisitStartInTx(tx, { workspaceId, userId, now })
                }
                return { charge: spent ?? null }
            },
        )
        const checkedIn = result !== null
        const charge = result?.charge ?? null

        let abonement: VisitAbonement | null = null
        if (charge) {
            const used = options.find((c) => c.id === charge.usedId)
            abonement = used
                ? {
                      ...toVisitAbonement(used),
                      classesRemaining:
                          charge.classesRemaining ?? used.classesRemaining,
                  }
                : null
        } else if (!checkedIn) {
            // A repeat scan: report what the earlier check-in was spent on.
            const record = await this.prisma.attendanceRecord.findUnique({
                where: { sessionId_userId: { sessionId: session.id, userId } },
                select: { usedSubscriptionId: true },
            })
            const usedId = record?.usedSubscriptionId
            abonement = usedId
                ? ((await loadUsedAbonements(this.prisma, [usedId])).get(usedId) ??
                  null)
                : null
        }
        // Nothing paid: "0 left" when a covering pack ran out (or its last
        // class went to a concurrent check-in), otherwise no balance to show.
        const classesRemaining = abonement
            ? abonement.classesRemaining
            : (checkedIn && options.length > 0) ||
                exhaustedPackCovers(candidates, visits.sessionDirectionId)
              ? 0
              : null

        if (checkedIn) {
            const consumedId = charge?.consumedId
            await syncLastAttendedAt(this.prisma, workspaceId, [userId]) // inactivity-nudge input
            await this.leaderboard.invalidate(workspaceId)
            // Coach roster + leaderboard for the club, merged per club so a
            // class-start burst is one refetch. The member's own attendance
            // and abonement refresh at once, on their room.
            this.realtime.invalidateCoalesced(workspaceId, [
                'attendance',
                'leaderboard',
            ])
            this.realtime.invalidateUsersInWorkspace([userId], workspaceId, [
                'attendance',
                'subscription',
            ])
            // Pack alert + achievements after commit; failures never reach the
            // student, whose check-in already stands.
            this.followUps.schedule({
                workspaceId,
                userIds: [userId],
                subscriptionIds: consumedId ? [consumedId] : [],
            })
        }

        return {
            sessionId: session.id,
            sessionTitle: session.title,
            startAt: session.startAt.toISOString(),
            checkedIn,
            classesRemaining,
            abonement,
        }
    }
}
