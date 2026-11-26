import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../../shared/utils/optimistic-concurrency'
import {
    MatchWinMethodSchema,
    TOURNAMENT_LIMITS,
    TournamentBracketOutputSchema,
    TournamentMatQueueOutputSchema,
    TournamentResultsOutputSchema,
} from './schemas'

// ─── drawTournamentDivision («Жеребьёвка» / «Пережеребить») ───────────────
export class DrawTournamentDivisionFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly divisionId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DrawTournamentDivisionFeatureResponse = z.infer<typeof TournamentBracketOutputSchema>

// ─── getTournamentBracket ────────────────────────────────────────────────
export class GetTournamentBracketFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly divisionId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetTournamentBracketFeatureResponse = z.infer<typeof TournamentBracketOutputSchema>

// ─── getTournamentMatQueue («Ковры») ─────────────────────────────────────
export class GetTournamentMatQueueFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly mat: number,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetTournamentMatQueueFeatureResponse = z.infer<typeof TournamentMatQueueOutputSchema>

// ─── recordTournamentMatchResult ─────────────────────────────────────────
const ScoreSchema = z
    .number()
    .int()
    .min(TOURNAMENT_LIMITS.score.min)
    .max(TOURNAMENT_LIMITS.score.max)

export const RecordTournamentMatchResultInputSchema = z.object({
    winnerEntryId: z.string().uuid(),
    method: MatchWinMethodSchema,
    // For points / decision.
    scoreA: ScoreSchema.nullable().optional(),
    scoreB: ScoreSchema.nullable().optional(),
    // «Приём» for a finish.
    note: z.string().trim().max(TOURNAMENT_LIMITS.note).nullable().optional(),
    // The match's updatedAt as read: a second tablet gets 409 STALE_UPDATE;
    // an identical retry of a stored result succeeds whatever it says.
    ...ExpectedUpdatedAtField,
})

export class RecordTournamentMatchResultFeature {
    constructor(
        readonly payload: z.infer<typeof RecordTournamentMatchResultInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly matchId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RecordTournamentMatchResultFeatureResponse = z.infer<
    typeof TournamentBracketOutputSchema
>

// ─── undoTournamentMatchResult ───────────────────────────────────────────
export const UndoTournamentMatchResultInputSchema = z.object({
    ...ExpectedUpdatedAtField,
})

export class UndoTournamentMatchResultFeature {
    constructor(
        readonly payload: z.infer<typeof UndoTournamentMatchResultInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly matchId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UndoTournamentMatchResultFeatureResponse = z.infer<
    typeof TournamentBracketOutputSchema
>

// ─── getTournamentResults («Итоги») ──────────────────────────────────────
export class GetTournamentResultsFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetTournamentResultsFeatureResponse = z.infer<typeof TournamentResultsOutputSchema>
