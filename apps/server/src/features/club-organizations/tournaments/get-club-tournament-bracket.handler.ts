import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadBracketView } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { isClubStaff } from '../events/club-org-events'
import { loadClubTournament } from './club-tournament-access'
import {
    GetClubTournamentBracketFeature,
    GetClubTournamentBracketFeatureResponse,
} from './club-tournaments.feature'
import { serializeClubPerson } from './schemas'

// A division's bracket for any member of a club of the federation, once the
// tournament runs: names per §2.3, «Участник скрыт» otherwise, never a
// weight, a birth year or a user id; `isMe` / `isMyClub` mark the viewer.
@Feature(GetClubTournamentBracketFeature)
export class GetClubTournamentBracketHandler
    implements
        IFeatureHandler<GetClubTournamentBracketFeature, GetClubTournamentBracketFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetClubTournamentBracketFeature) {
        const staff = await isClubStaff(this.prisma, f.workspaceId, f.invokerUserId, f.roleName)
        const { tournament: t } = await loadClubTournament(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff,
        })
        if (t.status !== 'RUNNING' && t.status !== 'FINISHED') {
            throw new NotFoundError({ message: 'Сетки появятся, когда турнир начнётся' })
        }
        const b = await loadBracketView(this.prisma, t.organizationId, t.id, f.divisionId)
        if (!b.division.drawnAt) throw new NotFoundError({ message: 'Сетка ещё не собрана' })
        const viewer = { userId: f.invokerUserId, workspaceId: f.workspaceId, staff }
        const person = (id: string | null) => {
            const e = id ? b.entries.get(id) : undefined
            return e ? serializeClubPerson(e, viewer) : null
        }
        const solo = b.matches.length === 0 ? b.waiting[0] : undefined
        return {
            division: {
                id: b.division.id,
                name: b.division.name,
                mat: b.division.mat,
                drawnAt: b.division.drawnAt.toISOString(),
                finishedAt: b.division.finishedAt?.toISOString() ?? null,
            },
            size: b.size,
            rounds: b.rounds,
            matches: b.matches.map((m) => ({
                id: m.id,
                round: m.round,
                position: m.position,
                isBye: m.isBye,
                entryA: person(m.entryAId),
                entryB: person(m.entryBId),
                winnerSide:
                    m.winnerEntryId === null
                        ? null
                        : m.winnerEntryId === m.entryAId
                          ? ('A' as const)
                          : ('B' as const),
                method: m.method,
                scoreA: m.scoreA,
                scoreB: m.scoreB,
                decidedAt: m.decidedAt?.toISOString() ?? null,
            })),
            soloWinner: solo ? { ...serializeClubPerson(solo, viewer), place: 1 } : null,
        }
    }
}
