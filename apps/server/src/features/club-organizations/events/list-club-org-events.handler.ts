import { Feature, IFeatureHandler } from '@shelfjs/features'

import { bookedCounts } from '../../../domains/organizations/org-events'
import { entryLineStates, toConfirmCounts } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { RbacService } from '../../../shared/services/rbac.service'
import { coachEntryScope } from '../tournaments/club-tournament-access'
import { clubOrgEventsWhere, CLUB_ORG_EVENT_SELECT, isClubStaff } from './club-org-events'
import {
    ListClubOrgEventsFeature,
    ListClubOrgEventsFeatureResponse,
} from './list-club-org-events.feature'
import { serializeClubOrgEvent } from './schemas'

// Upcoming federation events in the app's «События» (until they end), with
// the tournament line of a COMPETITION event: the viewer's entry state and,
// for the club's staff, the entries waiting for their confirmation.
@Feature(ListClubOrgEventsFeature)
export class ListClubOrgEventsHandler
    implements IFeatureHandler<ListClubOrgEventsFeature, ListClubOrgEventsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListClubOrgEventsFeature) {
        const now = new Date()
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.userId, f.roleName)
        const rows = await this.prisma.organizationEvent.findMany({
            where: {
                AND: [
                    clubOrgEventsWhere(f.workspaceId, staff, now),
                    { OR: [{ startAt: { gte: now } }, { endAt: { gte: now } }] },
                ],
            },
            select: CLUB_ORG_EVENT_SELECT,
            orderBy: { startAt: 'asc' },
            take: 100,
        })
        const ids = rows.map((r) => r.id)
        const [counts, mine, tournaments] = await Promise.all([
            bookedCounts(this.prisma, ids),
            this.prisma.organizationEventRegistration.findMany({
                where: { eventId: { in: ids }, userId: f.userId },
                select: { id: true, eventId: true, status: true, workspaceId: true },
            }),
            this.prisma.tournament.findMany({
                where: { eventId: { in: ids } },
                select: { id: true, eventId: true, status: true },
            }),
        ])
        const mineByEvent = new Map(mine.map((r) => [r.eventId, r]))
        const lines = await entryLineStates(this.prisma, {
            tournaments,
            bookedEventIds: new Set(
                mine
                    .filter((r) => r.status === 'BOOKED' && r.workspaceId === f.workspaceId)
                    .map((r) => r.eventId),
            ),
            userId: f.userId,
        })
        let toConfirm: Map<string, number> | null = null
        if (staff && tournaments.length > 0) {
            const ctx = await this.rbac.resolveCoachScope({
                userId: f.userId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: false,
            })
            toConfirm = await toConfirmCounts(this.prisma, {
                tournamentIds: tournaments.map((t) => t.id),
                workspaceId: f.workspaceId,
                userIds: await coachEntryScope(this.rbac, ctx),
            })
        }
        const tournamentByEvent = new Map(tournaments.map((t) => [t.eventId, t]))
        return {
            data: rows.map((r) => {
                const t = tournamentByEvent.get(r.id)
                return serializeClubOrgEvent(
                    r,
                    counts.get(r.id) ?? 0,
                    mineByEvent.get(r.id) ?? null,
                    now,
                    t
                        ? {
                              id: t.id,
                              status: t.status,
                              toConfirmCount: toConfirm ? (toConfirm.get(t.id) ?? 0) : null,
                          }
                        : null,
                    lines.get(r.id) ?? null,
                )
            }),
        }
    }
}
