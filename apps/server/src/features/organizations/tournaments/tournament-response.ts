import { loadTournamentCounts, type TournamentRow } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'
import { type OrgTournamentOutput, serializeOrgTournament } from './schemas'

// The tournament card every tournament-level route answers with.
export const tournamentResponse = async (
    prisma: PrismaService,
    t: TournamentRow,
): Promise<OrgTournamentOutput> => serializeOrgTournament(t, await loadTournamentCounts(prisma, t))
