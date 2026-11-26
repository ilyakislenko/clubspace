import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { gramsToKg } from '../../../domains/tournaments/divisions'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { countMats } from '../../../domains/tournaments/tournament-words'
import {
    DIVISION_SELECT,
    loadDivisionView,
    loadOrgTournament,
} from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { claimUnchanged } from '../../../shared/utils/optimistic-concurrency'
import { generatedName, loadTemplateLevels, resolveCriteria } from './division-input'
import {
    UpdateTournamentDivisionFeature,
    UpdateTournamentDivisionFeatureResponse,
} from './divisions.feature'
import { serializeTournamentDivision } from './schemas'

// «Изменить категорию» (side panel, expectedUpdatedAt) and the mat / queue
// place. A name still equal to the generated one follows the new criteria;
// a hand-edited name stays. Criteria never move anyone: entries keep their
// division (the org moves them).
@Feature(UpdateTournamentDivisionFeature)
export class UpdateTournamentDivisionHandler
    implements
        IFeatureHandler<UpdateTournamentDivisionFeature, UpdateTournamentDivisionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateTournamentDivisionFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (t.status === 'FINISHED') throw new TournamentPublishedError()
        const current = await this.prisma.tournamentDivision.findFirst({
            where: { id: f.divisionId, tournamentId: t.id },
            select: DIVISION_SELECT,
        })
        if (!current) throw new NotFoundError({ message: 'Категория не найдена' })
        const p = f.payload
        if (p.mat != null && p.mat > t.matCount) {
            throw new BadRequestError({ message: `В турнире ${countMats(t.matCount)}` })
        }
        const pick = <K extends keyof typeof p, V>(key: K, fallback: V) =>
            (p[key] === undefined ? fallback : p[key]) as V
        const templateId = pick('templateId', current.templateId)
        const levels = await loadTemplateLevels(
            this.prisma,
            f.organizationId,
            templateId ? [templateId] : [],
        )
        const kg = (g: number | null) => (g === null ? null : gramsToKg(g))
        const criteria = resolveCriteria(
            {
                sex: pick('sex', current.sex),
                ageMin: pick('ageMin', current.ageMin),
                ageMax: pick('ageMax', current.ageMax),
                templateId,
                levelOrderFrom: pick('levelOrderFrom', current.levelOrderFrom),
                levelOrderTo: pick('levelOrderTo', current.levelOrderTo),
                weightMinKg: pick('weightMinKg', kg(current.weightMinG)),
                weightMaxKg: pick('weightMaxKg', kg(current.weightMaxG)),
            },
            levels,
        )
        const autoNamed = current.name === generatedName({ ...current })
        const name = p.name ?? (autoNamed ? generatedName(criteria) : current.name)
        await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(p.expectedUpdatedAt, (expected) =>
                tx.tournamentDivision.updateMany({
                    where: { id: current.id, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            await tx.tournamentDivision.update({
                where: { id: current.id },
                data: {
                    ...criteria,
                    name,
                    ...(p.mat !== undefined ? { mat: p.mat } : {}),
                    ...(p.matOrder !== undefined ? { matOrder: p.matOrder } : {}),
                },
                select: { id: true },
            })
        })
        await this.audit.record({
            action: 'tournament.divisionUpdate',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                tournamentId: t.id,
                divisionId: current.id,
                divisionName: name,
                fields: Object.keys(p).filter((k) => k !== 'expectedUpdatedAt'),
            },
        })
        return serializeTournamentDivision(await loadDivisionView(this.prisma, t.id, current.id))
    }
}
