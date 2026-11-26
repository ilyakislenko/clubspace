import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { setTournamentStatus } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import { tournamentResponse } from './tournament-response'
import {
    SetOrgTournamentStatusFeature,
    SetOrgTournamentStatusFeatureResponse,
} from './tournament.feature'

// «Начать взвешивание» / «Вернуть приём заявок» / «Начать турнир» (the start
// withdraws the unweighed and draws every division).
@Feature(SetOrgTournamentStatusFeature)
export class SetOrgTournamentStatusHandler
    implements
        IFeatureHandler<SetOrgTournamentStatusFeature, SetOrgTournamentStatusFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: SetOrgTournamentStatusFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const result = await setTournamentStatus(this.prisma, {
            tournamentId: t.id,
            to: f.payload.status,
            now: new Date(),
        })
        if (result.from !== f.payload.status) {
            await this.audit.record({
                action: 'tournament.statusChange',
                targetType: 'tournament',
                targetId: t.id,
                organizationId: f.organizationId,
                actorId: f.invokerUserId,
                metadata: {
                    tournamentId: t.id,
                    fromStatus: result.from,
                    toStatus: f.payload.status,
                    ...(f.payload.status === 'RUNNING'
                        ? { withdrawnCount: result.withdrawn, drawnCount: result.drawn }
                        : {}),
                },
            })
        }
        return tournamentResponse(
            this.prisma,
            await loadOrgTournament(this.prisma, f.organizationId, t.id),
        )
    }
}
