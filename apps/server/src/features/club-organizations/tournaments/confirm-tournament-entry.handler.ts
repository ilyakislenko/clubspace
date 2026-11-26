import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    loadDivisionCriteria,
    loadEntryViews,
    TOURNAMENT_SELECT,
} from '../../../domains/tournaments/tournament-read'
import { confirmEntry } from '../../../domains/tournaments/tournament-store'
import { RealtimeEmitter } from '../../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { RbacService } from '../../../shared/services/rbac.service'
import { loadClubTournament, resolveConfirmation } from './club-tournament-access'
import {
    ConfirmTournamentEntryFeature,
    ConfirmTournamentEntryFeatureResponse,
} from './club-tournaments.feature'
import { serializeClubTournamentEntry } from './schemas'

// «Подтвердить» on the coach's phone: a student of the coach's own groups
// (admin scope: the club). The level comes from the registry, else the
// coach picks it; the matching division is found, or the federation assigns.
@Feature(ConfirmTournamentEntryFeature)
export class ConfirmTournamentEntryHandler
    implements
        IFeatureHandler<ConfirmTournamentEntryFeature, ConfirmTournamentEntryFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ConfirmTournamentEntryFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const row = await this.prisma.tournamentEntry.findFirst({
            where: { id: f.entryId, workspaceId: f.workspaceId },
            select: {
                id: true,
                userId: true,
                sex: true,
                birthYear: true,
                declaredWeightG: true,
                weighedWeightG: true,
                tournament: { select: TOURNAMENT_SELECT },
            },
        })
        if (!row) throw new NotFoundError({ message: 'Заявка не найдена' })
        await this.rbac.assertCanWriteMember(ctx, row.userId)
        // The event must still reach this club: a club that left the
        // federation confirms nothing there.
        await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: row.tournament.eventId,
            staff: true,
        })
        const t = row.tournament
        const confirmation = await resolveConfirmation(this.prisma, {
            tournament: t,
            entry: row,
            coachId: f.invokerUserId,
            pickedLevelId: f.payload.templateLevelId ?? null,
            required: true,
        })
        await confirmEntry(this.prisma, {
            tournamentId: t.id,
            entryId: row.id,
            confirmation,
            now: new Date(),
        })
        const [[entry], divisions] = await Promise.all([
            loadEntryViews(this.prisma, t.organizationId, { tournamentId: t.id, ids: [row.id] }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        const division = divisions.find((d) => d.id === entry.divisionId)
        await this.audit.record({
            action: 'tournament.entryConfirm',
            targetType: 'tournament',
            targetId: t.id,
            workspaceId: f.workspaceId,
            organizationId: t.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                entryId: row.id,
                divisionName: division?.name ?? null,
                levelFromRegistry: confirmation.levelSetById === null,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        return serializeClubTournamentEntry(entry, {
            division,
            tournamentStatus: t.status,
            nextMatch: null,
        })
    }
}
