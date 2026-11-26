import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { TournamentPublishedError } from '../../../domains/tournaments/tournament-errors'
import { loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import {
    DeleteTournamentDivisionFeature,
    DeleteTournamentDivisionFeatureResponse,
} from './divisions.feature'

// «Удалить» an empty division (nobody in it, withdrawn included).
@Feature(DeleteTournamentDivisionFeature)
export class DeleteTournamentDivisionHandler
    implements
        IFeatureHandler<DeleteTournamentDivisionFeature, DeleteTournamentDivisionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeleteTournamentDivisionFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (t.status === 'FINISHED') throw new TournamentPublishedError()
        const division = await this.prisma.tournamentDivision.findFirst({
            where: { id: f.divisionId, tournamentId: t.id },
            select: { id: true, name: true, _count: { select: { entries: true } } },
        })
        if (!division) throw new NotFoundError({ message: 'Категория не найдена' })
        if (division._count.entries > 0) {
            throw new BadRequestError({
                message: 'В категории есть участники — сначала переведите их',
            })
        }
        await this.prisma.tournamentDivision.delete({ where: { id: division.id } })
        await this.audit.record({
            action: 'tournament.divisionDelete',
            targetType: 'tournament',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { tournamentId: t.id, divisionId: division.id, divisionName: division.name },
        })
        return { status: 'deleted' as const }
    }
}
