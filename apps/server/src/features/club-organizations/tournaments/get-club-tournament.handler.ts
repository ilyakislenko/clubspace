import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    hasOrgConsent,
    ORG_SHARING_CONSENT_VERSION,
    orgSharingConsentText,
    TOURNAMENT_CONSENT_MIN_VERSION,
} from '../../../domains/organizations/consent'
import {
    loadDivisionCriteria,
    loadEntryViews,
    toConfirmCounts,
} from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { RbacService } from '../../../shared/services/rbac.service'
import { isClubStaff } from '../events/club-org-events'
import {
    birthYearOf,
    coachEntryScope,
    loadClubTournament,
    loadNextMatches,
} from './club-tournament-access'
import { GetClubTournamentFeature, GetClubTournamentFeatureResponse } from './club-tournaments.feature'
import { serializeClubTournamentEntry } from './schemas'

// The tournament screen of the app: the person's own entry (a guardian's
// child when acting for it) with the next match, whether they may declare,
// the consent state and, for the club's staff, the entries to confirm.
@Feature(GetClubTournamentFeature)
export class GetClubTournamentHandler
    implements IFeatureHandler<GetClubTournamentFeature, GetClubTournamentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetClubTournamentFeature) {
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.invokerUserId, f.roleName)
        const { event, tournament: t } = await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff,
        })
        const now = new Date()
        const [registration, user, consentCurrent, divisions] = await Promise.all([
            this.prisma.organizationEventRegistration.findFirst({
                where: {
                    eventId: event.id,
                    userId: f.invokerUserId,
                    workspaceId: f.workspaceId,
                    status: 'BOOKED',
                },
                select: { id: true },
            }),
            this.prisma.user.findUnique({
                where: { id: f.invokerUserId },
                select: { dateOfBirth: true },
            }),
            hasOrgConsent(this.prisma, t.organizationId, f.invokerUserId, {
                minVersion: TOURNAMENT_CONSENT_MIN_VERSION,
            }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        const [entry] = await loadEntryViews(this.prisma, t.organizationId, {
            tournamentId: t.id,
            workspaceId: f.workspaceId,
            userIds: [f.invokerUserId],
        })
        const viewer = { userId: f.invokerUserId, workspaceId: f.workspaceId, staff }
        const nexts = entry ? await loadNextMatches(this.prisma, t, [entry], viewer) : new Map()
        const byId = new Map(divisions.map((d) => [d.id, d]))
        const templateIds = [
            ...new Set(divisions.map((d) => d.templateId).filter((id): id is string => !!id)),
        ]
        const templates = templateIds.length
            ? await this.prisma.organizationLadderTemplate.findMany({
                  where: { id: { in: templateIds }, organizationId: t.organizationId },
                  select: {
                      id: true,
                      name: true,
                      levels: { select: { id: true, name: true, order: true }, orderBy: { order: 'asc' } },
                  },
              })
            : []
        let toConfirmCount: number | null = null
        if (staff) {
            const ctx = await this.rbac.resolveCoachScope({
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            })
            const counts = await toConfirmCounts(this.prisma, {
                tournamentIds: [t.id],
                workspaceId: f.workspaceId,
                userIds: await coachEntryScope(this.rbac, ctx),
            })
            toConfirmCount = counts.get(t.id) ?? 0
        }
        const closes = t.event.registrationClosesAt
        return {
            id: t.id,
            eventId: event.id,
            organizationId: t.organizationId,
            organizationName: event.organization.name,
            eventTitle: event.title,
            status: t.status,
            matCount: t.matCount,
            resultsPublishedAt: t.resultsPublishedAt?.toISOString() ?? null,
            myRegistrationId: registration?.id ?? null,
            myEntry: entry
                ? serializeClubTournamentEntry(entry, {
                      division: entry.divisionId ? byId.get(entry.divisionId) : undefined,
                      tournamentStatus: t.status,
                      nextMatch: nexts.get(entry.id) ?? null,
                  })
                : null,
            canDeclare:
                t.status === 'SETUP' && registration !== null && (!closes || closes > now),
            profileBirthYear: birthYearOf(user?.dateOfBirth ?? null),
            consentCurrent,
            consentText: orgSharingConsentText(event.organization.name, f.guardianId !== null),
            consentVersion: ORG_SHARING_CONSENT_VERSION,
            levels: templates.flatMap((tpl) =>
                tpl.levels.map((l) => ({
                    id: l.id,
                    name: l.name,
                    order: l.order,
                    templateId: tpl.id,
                    templateName: tpl.name,
                })),
            ),
            toConfirmCount,
        }
    }
}
