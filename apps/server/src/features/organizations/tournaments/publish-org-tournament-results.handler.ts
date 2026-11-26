import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { setResultsPublished } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import { tournamentResponse } from './tournament-response'
import {
    PublishOrgTournamentResultsFeature,
    PublishOrgTournamentResultsFeatureResponse,
} from './tournament.feature'

// «Опубликовать итоги» / «Снять публикацию» — org admins only: published
// places reach the registry and «Мои пояса».
@Feature(PublishOrgTournamentResultsFeature)
export class PublishOrgTournamentResultsHandler
    implements
        IFeatureHandler<
            PublishOrgTournamentResultsFeature,
            PublishOrgTournamentResultsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: PublishOrgTournamentResultsFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            {
                userId: f.invokerUserId,
                organizationId: f.organizationId,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Итоги публикует администратор федерации',
        )
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const { changed } = await setResultsPublished(this.prisma, {
            tournamentId: t.id,
            published: f.payload.published,
            now: new Date(),
        })
        if (changed) {
            await this.audit.record({
                action: f.payload.published ? 'tournament.publish' : 'tournament.unpublish',
                targetType: 'tournament',
                targetId: t.id,
                organizationId: f.organizationId,
                actorId: f.invokerUserId,
                metadata: { tournamentId: t.id },
            })
        }
        return tournamentResponse(
            this.prisma,
            await loadOrgTournament(this.prisma, f.organizationId, t.id),
        )
    }
}
