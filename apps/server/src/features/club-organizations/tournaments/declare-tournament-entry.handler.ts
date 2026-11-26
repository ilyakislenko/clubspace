import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    hasOrgConsent,
    OrgConsentRequiredError,
    TOURNAMENT_CONSENT_MIN_VERSION,
} from '../../../domains/organizations/consent'
import { kgToGrams } from '../../../domains/tournaments/divisions'
import { TournamentLockedError } from '../../../domains/tournaments/tournament-errors'
import { loadDivisionCriteria, loadEntryViews } from '../../../domains/tournaments/tournament-read'
import { declareEntry } from '../../../domains/tournaments/tournament-store'
import { RealtimeEmitter } from '../../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { RbacService } from '../../../shared/services/rbac.service'
import { isClubStaff } from '../events/club-org-events'
import { birthYearOf, loadClubTournament, resolveConfirmation } from './club-tournament-access'
import {
    DeclareTournamentEntryFeature,
    DeclareTournamentEntryFeatureResponse,
} from './club-tournaments.feature'
import { serializeClubTournamentEntry } from './schemas'

// «Заявка: укажите вес». The athlete (a guardian for the child) declares →
// DECLARED, waiting for their coach; a coach declaring for a student of their
// groups → CONFIRMED with the division found. Needs a booking through this
// club, SETUP, and the person's consent at the tournament edition (a coach
// can't consent for a student).
@Feature(DeclareTournamentEntryFeature)
export class DeclareTournamentEntryHandler
    implements
        IFeatureHandler<DeclareTournamentEntryFeature, DeclareTournamentEntryFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeclareTournamentEntryFeature) {
        const targetId = f.payload.userId ?? f.invokerUserId
        const byCoach = targetId !== f.invokerUserId
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.invokerUserId, f.roleName)
        const { tournament: t } = await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff,
        })
        if (byCoach) {
            const ctx = await this.rbac.resolveCoachScope({
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            })
            await this.rbac.assertCanWriteMember(ctx, targetId)
        }
        const registration = await this.prisma.organizationEventRegistration.findFirst({
            where: {
                eventId: t.eventId,
                userId: targetId,
                workspaceId: f.workspaceId,
                status: 'BOOKED',
            },
            select: { id: true },
        })
        if (!registration) {
            throw new NotFoundError({ message: 'Сначала запишитесь на турнир через этот клуб' })
        }
        const now = new Date()
        const closes = t.event.registrationClosesAt
        if (t.status !== 'SETUP' || (closes && closes <= now)) throw new TournamentLockedError()
        if (
            !(await hasOrgConsent(this.prisma, t.organizationId, targetId, {
                minVersion: TOURNAMENT_CONSENT_MIN_VERSION,
            }))
        ) {
            throw new OrgConsentRequiredError(
                byCoach
                    ? 'Ученик должен обновить согласие в приложении'
                    : 'Подтвердите новую редакцию согласия федерации — она включает турниры',
            )
        }
        const user = await this.prisma.user.findUnique({
            where: { id: targetId },
            select: { dateOfBirth: true },
        })
        const birthYear = f.payload.birthYear ?? birthYearOf(user?.dateOfBirth ?? null)
        if (birthYear === null) throw new BadRequestError({ message: 'Укажите год рождения' })
        if (birthYear < 1930 || birthYear > now.getUTCFullYear()) {
            throw new BadRequestError({ message: 'Проверьте год рождения' })
        }
        const declaredWeightG = kgToGrams(f.payload.declaredWeightKg)
        const confirmation = byCoach
            ? await resolveConfirmation(this.prisma, {
                  tournament: t,
                  entry: {
                      userId: targetId,
                      sex: f.payload.sex,
                      birthYear,
                      declaredWeightG,
                      weighedWeightG: null,
                  },
                  coachId: f.invokerUserId,
                  pickedLevelId: null,
                  required: false,
              })
            : null
        const { entryId } = await declareEntry(this.prisma, {
            tournamentId: t.id,
            registrationId: registration.id,
            userId: targetId,
            workspaceId: f.workspaceId,
            sex: f.payload.sex,
            birthYear,
            declaredWeightG,
            declaredById: f.guardianId ?? f.invokerUserId,
            confirmation,
            now,
        })
        await this.audit.record({
            action: 'tournament.entryDeclare',
            targetType: 'tournament',
            targetId: t.id,
            workspaceId: f.workspaceId,
            organizationId: t.organizationId,
            actorId: f.guardianId ?? f.invokerUserId,
            metadata: { tournamentId: t.id, eventId: t.eventId, entryId, byCoach },
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        const [[entry], divisions] = await Promise.all([
            loadEntryViews(this.prisma, t.organizationId, { tournamentId: t.id, ids: [entryId] }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        return serializeClubTournamentEntry(entry, {
            division: divisions.find((d) => d.id === entry.divisionId),
            tournamentStatus: t.status,
            nextMatch: null,
        })
    }
}
