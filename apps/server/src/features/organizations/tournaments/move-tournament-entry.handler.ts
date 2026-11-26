import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import {
    entryFits,
    loadDivisionCriteria,
    loadEntryViews,
    loadOrgTournament,
} from '../../../domains/tournaments/tournament-read'
import { moveEntry } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import { MoveTournamentEntryFeature, MoveTournamentEntryFeatureResponse } from './entries.feature'
import { serializeTournamentEntryRow } from './schemas'

// «Перевести в «…»» / «Другая категория». In RUNNING only while neither
// division has results; both brackets then wait for a new draw.
@Feature(MoveTournamentEntryFeature)
export class MoveTournamentEntryHandler
    implements IFeatureHandler<MoveTournamentEntryFeature, MoveTournamentEntryFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: MoveTournamentEntryFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const { fromDivisionId } = await moveEntry(this.prisma, {
            tournamentId: t.id,
            entryId: f.entryId,
            toDivisionId: f.payload.divisionId,
        })
        const [[entry], divisions] = await Promise.all([
            loadEntryViews(this.prisma, f.organizationId, { tournamentId: t.id, ids: [f.entryId] }),
            loadDivisionCriteria(this.prisma, t.id),
        ])
        const byId = new Map(divisions.map((d) => [d.id, d]))
        const to = byId.get(f.payload.divisionId)
        if (fromDivisionId !== f.payload.divisionId) {
            await this.audit.record({
                action: 'tournament.entryMove',
                targetType: 'tournament',
                targetId: t.id,
                organizationId: f.organizationId,
                actorId: f.invokerUserId,
                metadata: {
                    tournamentId: t.id,
                    entryId: entry.id,
                    fromDivisionId,
                    toDivisionId: f.payload.divisionId,
                    fromDivisionName: fromDivisionId ? (byId.get(fromDivisionId)?.name ?? null) : null,
                    toDivisionName: to?.name ?? null,
                },
            })
        }
        return serializeTournamentEntryRow(entry, to, entryFits(entry, to))
    }
}
