import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../../domains/organizations/org-access'
import { isReady, matQueue } from '../../../domains/tournaments/schedule'
import {
    loadEntryViews,
    loadOrgTournament,
    MATCH_SELECT,
} from '../../../domains/tournaments/tournament-read'
import { nextSlot } from '../../../domains/tournaments/bracket'
import { countMats } from '../../../domains/tournaments/tournament-words'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'
import {
    GetTournamentMatQueueFeature,
    GetTournamentMatQueueFeatureResponse,
} from './matches.feature'
import { serializeTournamentMatch } from './schemas'

const NEXT_COUNT = 5

// «Ковры»: the match on this mat now and the next five.
@Feature(GetTournamentMatQueueFeature)
export class GetTournamentMatQueueHandler
    implements
        IFeatureHandler<GetTournamentMatQueueFeature, GetTournamentMatQueueFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetTournamentMatQueueFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await loadOrgTournament(this.prisma, f.organizationId, f.tournamentId)
        if (f.mat < 1 || f.mat > t.matCount) {
            throw new BadRequestError({ message: `В турнире ${countMats(t.matCount)}` })
        }
        const [divisions, matches] = await Promise.all([
            this.prisma.tournamentDivision.findMany({
                where: { tournamentId: t.id },
                select: {
                    id: true,
                    name: true,
                    sortOrder: true,
                    mat: true,
                    matOrder: true,
                    drawnAt: true,
                    finishedAt: true,
                },
            }),
            this.prisma.tournamentMatch.findMany({
                where: { tournamentId: t.id },
                select: MATCH_SELECT,
            }),
        ])
        const queue = matQueue(divisions, matches, f.mat).slice(0, NEXT_COUNT + 1)
        const entries = await loadEntryViews(this.prisma, f.organizationId, {
            tournamentId: t.id,
            ids: queue.flatMap((m) => [m.entryAId!, m.entryBId!]),
        })
        const byEntry = new Map(entries.map((e) => [e.id, e]))
        const idAt = new Map(
            matches.map((m) => [`${m.divisionId}:${m.round}:${m.position}`, m.id]),
        )
        const nameOf = new Map(divisions.map((d) => [d.id, d.name]))
        const rows = queue.map((m) => {
            const next = nextSlot(m.round, m.position)
            return {
                ...serializeTournamentMatch(
                    {
                        ...m,
                        ready: isReady(m),
                        nextMatchId: idAt.get(`${m.divisionId}:${next.round}:${next.position}`) ?? null,
                    },
                    byEntry,
                ),
                divisionName: nameOf.get(m.divisionId) ?? '',
            }
        })
        const unassignedDivisions = divisions.filter(
            (d) => d.mat === null && d.drawnAt !== null && d.finishedAt === null,
        ).length
        return {
            mat: f.mat,
            current: rows[0] ?? null,
            next: rows.slice(1),
            unassignedDivisions,
        }
    }
}
