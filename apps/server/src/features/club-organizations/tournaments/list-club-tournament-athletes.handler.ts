import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    consentedPersonIds,
    TOURNAMENT_CONSENT_MIN_VERSION,
} from '../../../domains/organizations/consent'
import { registryLevelsFor } from '../../../domains/organizations/registry'
import { loadDivisionCriteria, loadEntryViews } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { fullNameWithoutEmail } from '../../../shared/utils/person-name'
import { ownGroupsWhere, RbacService } from '../../../shared/services/rbac.service'
import { coachEntryScope, loadClubTournament, birthYearOf, loadNextMatches } from './club-tournament-access'
import {
    ListClubTournamentAthletesFeature,
    ListClubTournamentAthletesFeatureResponse,
} from './club-tournaments.feature'
import { serializeClubTournamentEntry } from './schemas'

// «Мои спортсмены» on the coach's phone: the students of the coach's groups
// (a coach who sees every group, or admin scope: the club, plus anyone booked
// through it) with their booking, entry, division, weights, next match and
// place.
@Feature(ListClubTournamentAthletesFeature)
export class ListClubTournamentAthletesHandler
    implements
        IFeatureHandler<
            ListClubTournamentAthletesFeature,
            ListClubTournamentAthletesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListClubTournamentAthletesFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const { tournament: t } = await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff: true,
        })
        const all = this.rbac.canSeeAllGroups(ctx)
        // Only people booked on the event through this club: an entry needs
        // the booking, and the phone polls this list while the tournament
        // runs (a whole club of «не записан» rows is noise and payload).
        const booked = await this.prisma.organizationEventRegistration.findMany({
            where: { eventId: t.eventId, workspaceId: f.workspaceId, status: 'BOOKED' },
            select: {
                id: true,
                userId: true,
                user: {
                    select: { id: true, firstname: true, lastname: true, dateOfBirth: true },
                },
            },
        })
        // A coach's scope: the booked students of their own groups.
        const ownStudents = all
            ? null
            : new Set(
                  (
                      await this.prisma.groupMember.findMany({
                          where: {
                              userId: { in: booked.map((b) => b.userId) },
                              group: { workspaceId: f.workspaceId, ...ownGroupsWhere(f.invokerUserId) },
                          },
                          distinct: ['userId'],
                          select: { userId: true },
                      })
                  ).map((s) => s.userId),
              )
        const people = new Map(
            booked.filter((b) => !ownStudents || ownStudents.has(b.userId)).map((b) => [b.userId, b.user]),
        )
        const ids = [...people.keys()]
        const regByUser = new Map(booked.map((b) => [b.userId, b.id]))
        const [consented, levels, entries, divisions, writable] = await Promise.all([
            consentedPersonIds(this.prisma, t.organizationId, ids, {
                minVersion: TOURNAMENT_CONSENT_MIN_VERSION,
            }),
            registryLevelsFor(this.prisma, t.organizationId, ids),
            loadEntryViews(this.prisma, t.organizationId, {
                tournamentId: t.id,
                workspaceId: f.workspaceId,
                userIds: ids,
            }),
            loadDivisionCriteria(this.prisma, t.id),
            coachEntryScope(this.rbac, ctx),
        ])
        const viewer = { userId: f.invokerUserId, workspaceId: f.workspaceId, staff: true }
        const nexts = await loadNextMatches(this.prisma, t, entries, viewer)
        const entryByUser = new Map(entries.map((e) => [e.userId, e]))
        const byDivision = new Map(divisions.map((d) => [d.id, d]))
        const writableSet = writable ? new Set(writable) : null
        const data = [...people.values()]
            .map((u) => {
                const e = entryByUser.get(u.id)
                const level = levels.get(u.id)
                return {
                    userId: u.id,
                    name: fullNameWithoutEmail(u),
                    registrationId: regByUser.get(u.id) ?? null,
                    consentCurrent: consented.has(u.id),
                    profileBirthYear: birthYearOf(u.dateOfBirth),
                    registryLevel: level
                        ? { templateLevelId: level.templateLevelId, name: level.name }
                        : null,
                    entry: e
                        ? serializeClubTournamentEntry(e, {
                              division: e.divisionId ? byDivision.get(e.divisionId) : undefined,
                              tournamentStatus: t.status,
                              nextMatch: nexts.get(e.id) ?? null,
                          })
                        : null,
                }
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        const toConfirmCount = entries.filter(
            (e) => e.status === 'DECLARED' && (!writableSet || writableSet.has(e.userId)),
        ).length
        return { data, toConfirmCount }
    }
}
