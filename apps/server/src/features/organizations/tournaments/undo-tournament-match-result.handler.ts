import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadBracketView, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { undoResult } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    UndoTournamentMatchResultFeature,
    UndoTournamentMatchResultFeatureResponse,
} from './matches.feature'
import { serializeTournamentBracket } from './schemas'

// «Отменить» (toast) / «⋯ → Отменить результат»: only at the frontier and
// never after publication. The journal keeps the undone result.
@Feature(UndoTournamentMatchResultFeature)
export class UndoTournamentMatchResultHandler
    implements
        IFeatureHandler<UndoTournamentMatchResultFeature, UndoTournamentMatchResultFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UndoTournamentMatchResultFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const undone = await undoResult(this.prisma, {
            tournamentId: t.id,
            matchId: f.matchId,
            expectedUpdatedAt: f.payload.expectedUpdatedAt,
            now: new Date(),
        })
        const bracket = await loadBracketView(this.prisma, f.organizationId, t.id, undone.divisionId)
        await this.audit.record({
            action: 'tournament.matchUndo',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                divisionId: undone.divisionId,
                divisionName: bracket.division.name,
                matchId: f.matchId,
                round: undone.round,
                position: undone.position,
                previous: undone.previous,
            },
        })
        return serializeTournamentBracket(bracket)
    }
}
