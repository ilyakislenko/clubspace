import { Feature, IFeatureHandler } from '@shelfjs/features'

import { localDateInTz } from '../../../features/attendance/attendance-utils'
import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import {
    entryFacts,
    fitsWeight,
    kgToGrams,
    matchDivision,
    suggestDivision,
} from '../../../domains/tournaments/divisions'
import {
    entryFits,
    loadDivisionCriteria,
    loadEntryViews,
    loadLevelRefs,
    loadOrgTournament,
} from '../../../domains/tournaments/tournament-read'
import { recordWeighIn } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    RecordTournamentWeighInFeature,
    RecordTournamentWeighInFeatureResponse,
} from './entries.feature'
import { serializeTournamentEntryRow } from './schemas'

// «Записать вес» at the scale (WEIGH_IN). A DECLARED entry is confirmed by
// the weigher; an entry without a division gets the one that fits. The
// answer says whether the weight fits and which division to move to
// («Перевести в «до 82 кг»»).
@Feature(RecordTournamentWeighInFeature)
export class RecordTournamentWeighInHandler
    implements
        IFeatureHandler<RecordTournamentWeighInFeature, RecordTournamentWeighInFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: RecordTournamentWeighInFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const [before] = await loadEntryViews(this.prisma, f.organizationId, {
            tournamentId: t.id,
            ids: [f.entryId],
        })
        if (!before) throw new NotFoundError({ message: 'Участник не найден' })
        const weighedWeightG = kgToGrams(f.payload.weighedKg)
        const [divisions, levels] = await Promise.all([
            loadDivisionCriteria(this.prisma, t.id),
            loadLevelRefs(this.prisma, f.organizationId, [before.templateLevelId]),
        ])
        const localDate = localDateInTz(t.event.startAt, t.event.timezone)
        const level = before.templateLevelId ? (levels.get(before.templateLevelId) ?? null) : null
        const facts = entryFacts({ ...before, weighedWeightG }, localDate, level)
        const assign = before.divisionId ? null : (matchDivision(facts, divisions)?.id ?? null)
        await recordWeighIn(this.prisma, {
            tournamentId: t.id,
            entryId: before.id,
            weighedWeightG,
            actorId: f.invokerUserId,
            now: new Date(),
            assignDivisionId: assign,
        })
        const [entry] = await loadEntryViews(this.prisma, f.organizationId, {
            tournamentId: t.id,
            ids: [before.id],
        })
        const byId = new Map(divisions.map((d) => [d.id, d]))
        const current = entry.divisionId ? byId.get(entry.divisionId) : undefined
        const fitsNow = current ? fitsWeight(weighedWeightG, current) : false
        const suggested = fitsNow ? null : suggestDivision(facts, divisions, entry.divisionId)
        await this.audit.record({
            action: 'tournament.weighIn',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                entryId: entry.id,
                divisionName: current?.name ?? null,
            },
        })
        return {
            entry: serializeTournamentEntryRow(entry, current, entryFits(entry, current)),
            fits: fitsNow,
            suggestedDivisionId: suggested?.id ?? null,
            suggestedDivisionName: suggested?.name ?? null,
        }
    }
}
