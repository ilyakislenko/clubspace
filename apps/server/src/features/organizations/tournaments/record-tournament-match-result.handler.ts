import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../../domains/notifications/services/notification-producer.service'
import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { notifyMatchSoon } from '../../../domains/tournaments/tournament-dispatch'
import { loadBracketView, loadOrgTournament } from '../../../domains/tournaments/tournament-read'
import { recordResult } from '../../../domains/tournaments/tournament-store'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    RecordTournamentMatchResultFeature,
    RecordTournamentMatchResultFeatureResponse,
} from './matches.feature'
import { serializeTournamentBracket } from './schemas'

// «Записать» at the mat table: the winner advances, the final settles the
// places. A second tablet gets STALE_UPDATE; an identical retry succeeds.
// The next entrants on the mat hear «Скоро ваша схватка» after the commit.
@Feature(RecordTournamentMatchResultFeature)
export class RecordTournamentMatchResultHandler
    implements
        IFeatureHandler<
            RecordTournamentMatchResultFeature,
            RecordTournamentMatchResultFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: RecordTournamentMatchResultFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        const p = f.payload
        const now = new Date()
        const result = await recordResult(this.prisma, {
            tournamentId: t.id,
            matchId: f.matchId,
            result: {
                winnerEntryId: p.winnerEntryId,
                method: p.method,
                scoreA: p.scoreA ?? null,
                scoreB: p.scoreB ?? null,
                note: p.note ?? null,
            },
            expectedUpdatedAt: p.expectedUpdatedAt,
            actorId: f.invokerUserId,
            now,
        })
        const bracket = await loadBracketView(this.prisma, f.organizationId, t.id, result.divisionId)
        if (!result.retried) {
            await this.audit.record({
                action: 'tournament.matchResult',
                targetType: 'tournament',
                targetId: t.id,
                organizationId: f.organizationId,
                actorId: f.invokerUserId,
                metadata: {
                    tournamentId: t.id,
                    divisionId: result.divisionId,
                    divisionName: bracket.division.name,
                    matchId: f.matchId,
                    round: result.round,
                    position: result.position,
                    method: p.method,
                },
            })
            await notifyMatchSoon(this.prisma, this.notifications, {
                tournamentId: t.id,
                mat: bracket.division.mat,
                now,
            })
        }
        return serializeTournamentBracket(bracket)
    }
}
