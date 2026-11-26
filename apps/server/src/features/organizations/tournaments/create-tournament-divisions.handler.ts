import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { loadDivisionViews, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'
import { generatedName, loadTemplateLevels, resolveCriteria } from './division-input'
import {
    CreateTournamentDivisionsFeature,
    CreateTournamentDivisionsFeatureResponse,
} from './divisions.feature'
import { serializeTournamentDivision, TOURNAMENT_LIMITS } from './schemas'

// «Добавить категории»: the generator's rows in one call, names generated
// from the criteria unless given. Appended after the existing divisions.
@Feature(CreateTournamentDivisionsFeature)
export class CreateTournamentDivisionsHandler
    implements
        IFeatureHandler<CreateTournamentDivisionsFeature, CreateTournamentDivisionsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateTournamentDivisionsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (t.status === 'FINISHED') throw new TournamentPublishedError()
        const rows = f.payload.rows
        const levels = await loadTemplateLevels(
            this.prisma,
            f.organizationId,
            rows.map((r) => r.templateId).filter((id): id is string => !!id),
        )
        const data = rows.map((r) => {
            const criteria = resolveCriteria(
                {
                    sex: r.sex ?? null,
                    ageMin: r.ageMin ?? null,
                    ageMax: r.ageMax ?? null,
                    templateId: r.templateId ?? null,
                    levelOrderFrom: r.levelOrderFrom ?? null,
                    levelOrderTo: r.levelOrderTo ?? null,
                    weightMinKg: r.weightMinKg ?? null,
                    weightMaxKg: r.weightMaxKg ?? null,
                },
                levels,
            )
            return { ...criteria, name: r.name ?? generatedName(criteria) }
        })
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.tournamentDivision.aggregate({
                where: { tournamentId: t.id },
                _count: { _all: true },
                _max: { sortOrder: true },
            })
            if (existing._count._all + data.length > TOURNAMENT_LIMITS.divisionsPerTournament) {
                throw new BadRequestError({
                    message: `В турнире не больше ${TOURNAMENT_LIMITS.divisionsPerTournament} категорий`,
                })
            }
            const start = (existing._max.sortOrder ?? 0) + 1
            await tx.tournamentDivision.createMany({
                data: data.map((d, i) => ({ ...d, tournamentId: t.id, sortOrder: start + i })),
            })
        })
        await this.audit.record({
            action: 'tournament.divisionsCreate',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { tournamentId: t.id, count: data.length },
        })
        const views = await loadDivisionViews(this.prisma, t.id)
        return { data: views.map(serializeTournamentDivision) }
    }
}
