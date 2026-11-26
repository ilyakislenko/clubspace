import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { loadDivisionViews, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'
import {
    CopyTournamentDivisionsFeature,
    CopyTournamentDivisionsFeatureResponse,
} from './divisions.feature'
import { serializeTournamentDivision, TOURNAMENT_LIMITS } from './schemas'

// «Скопировать из турнира…»: criteria, names and mats of another tournament
// of the same org, appended; no entries, no brackets.
@Feature(CopyTournamentDivisionsFeature)
export class CopyTournamentDivisionsHandler
    implements
        IFeatureHandler<CopyTournamentDivisionsFeature, CopyTournamentDivisionsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CopyTournamentDivisionsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (t.status === 'FINISHED') throw new TournamentPublishedError()
        if (f.payload.fromTournamentId === t.id) {
            throw new BadRequestError({ message: 'Выберите другой турнир' })
        }
        const source = await loadOrgTournament(
            this.prisma,
            f.organizationId,
            f.payload.fromTournamentId,
        )
        const rows = await this.prisma.tournamentDivision.findMany({
            where: { tournamentId: source.id },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
                name: true,
                sex: true,
                ageMin: true,
                ageMax: true,
                templateId: true,
                levelOrderFrom: true,
                levelOrderTo: true,
                levelLabel: true,
                weightMinG: true,
                weightMaxG: true,
                mat: true,
                matOrder: true,
            },
        })
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.tournamentDivision.aggregate({
                where: { tournamentId: t.id },
                _count: { _all: true },
                _max: { sortOrder: true },
            })
            if (existing._count._all + rows.length > TOURNAMENT_LIMITS.divisionsPerTournament) {
                throw new BadRequestError({
                    message: `В турнире не больше ${TOURNAMENT_LIMITS.divisionsPerTournament} категорий`,
                })
            }
            const start = (existing._max.sortOrder ?? 0) + 1
            await tx.tournamentDivision.createMany({
                data: rows.map((r, i) => ({
                    ...r,
                    mat: r.mat !== null && r.mat <= t.matCount ? r.mat : null,
                    matOrder: r.mat !== null && r.mat <= t.matCount ? r.matOrder : null,
                    tournamentId: t.id,
                    sortOrder: start + i,
                })),
            })
        })
        await this.audit.record({
            action: 'tournament.divisionsCopy',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { tournamentId: t.id, fromTournamentId: source.id, count: rows.length },
        })
        const views = await loadDivisionViews(this.prisma, t.id)
        return { data: views.map(serializeTournamentDivision) }
    }
}
