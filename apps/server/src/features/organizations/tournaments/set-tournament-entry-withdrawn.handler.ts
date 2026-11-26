import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import {
    entryFits,
    loadDivisionCriteria,
    loadEntryViews,
    loadOrgTournament,
} from '../../../domains/tournaments/tournament-read'
import { setEntryWithdrawn } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    SetTournamentEntryWithdrawnFeature,
    SetTournamentEntryWithdrawnFeatureResponse,
} from './entries.feature'
import { serializeTournamentEntryRow } from './schemas'

// «⋯ → Снять с турнира» (and back) while the division has no results.
@Feature(SetTournamentEntryWithdrawnFeature)
export class SetTournamentEntryWithdrawnHandler
    implements
        IFeatureHandler<
            SetTournamentEntryWithdrawnFeature,
            SetTournamentEntryWithdrawnFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: SetTournamentEntryWithdrawnFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const reason = f.payload.withdrawn ? f.payload.reason || 'Снят секретарём' : null
        await setEntryWithdrawn(this.prisma, {
            tournamentId: t.id,
            entryId: f.entryId,
            withdrawn: f.payload.withdrawn,
            reason,
        })
        const [[entry], divisions] = await Promise.all([
            loadEntryViews(this.prisma, f.organizationId, { tournamentId: t.id, ids: [f.entryId] }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        const d = entry.divisionId ? divisions.find((x) => x.id === entry.divisionId) : undefined
        await this.audit.record({
            action: 'tournament.entryWithdraw',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                entryId: entry.id,
                withdrawn: f.payload.withdrawn,
                reason,
                divisionName: d?.name ?? null,
            },
        })
        return serializeTournamentEntryRow(entry, d, entryFits(entry, d))
    }
}
