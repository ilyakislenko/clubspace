import { z } from 'zod'

import { TOURNAMENT_LIMITS, TournamentEntryRowSchema, WeightKgSchema } from './schemas'

// ─── listTournamentEntries («Участники») ──────────────────────────────────
export const TournamentEntryFilterSchema = z.enum([
    'all',
    'unweighed',
    'offWeight',
    'unassigned',
    'withdrawn',
    'declared',
])
export const ListTournamentEntriesInputSchema = z.object({
    // Part of a name or surname.
    q: z.string().trim().max(100).optional(),
    divisionId: z.string().uuid().optional(),
    // all: everyone but the withdrawn; unweighed: confirmed, no weight yet;
    // offWeight: weighed outside the division; unassigned: confirmed, no
    // division; withdrawn; declared: waiting for the coach.
    filter: TournamentEntryFilterSchema.optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(200).optional(),
})
export const ListTournamentEntriesOutputSchema = z.object({
    data: z.array(TournamentEntryRowSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListTournamentEntriesFeature {
    constructor(
        readonly payload: z.infer<typeof ListTournamentEntriesInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListTournamentEntriesFeatureResponse = z.infer<
    typeof ListTournamentEntriesOutputSchema
>

// ─── recordTournamentWeighIn ─────────────────────────────────────────────
export const RecordTournamentWeighInInputSchema = z.object({
    weighedKg: WeightKgSchema,
})
export const RecordTournamentWeighInOutputSchema = z.object({
    entry: TournamentEntryRowSchema,
    // The weight fits the entry's division (false without a division).
    fits: z.boolean(),
    // «Перевести в «до 82 кг»»: the division with the same criteria the
    // weight fits, or the only fitting one when the entry has none.
    suggestedDivisionId: z.string().uuid().nullable(),
    suggestedDivisionName: z.string().nullable(),
})

export class RecordTournamentWeighInFeature {
    constructor(
        readonly payload: z.infer<typeof RecordTournamentWeighInInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly entryId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RecordTournamentWeighInFeatureResponse = z.infer<
    typeof RecordTournamentWeighInOutputSchema
>

// ─── moveTournamentEntry ─────────────────────────────────────────────────
export const MoveTournamentEntryInputSchema = z.object({
    divisionId: z.string().uuid(),
})
export const MoveTournamentEntryOutputSchema = TournamentEntryRowSchema

export class MoveTournamentEntryFeature {
    constructor(
        readonly payload: z.infer<typeof MoveTournamentEntryInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly entryId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type MoveTournamentEntryFeatureResponse = z.infer<typeof MoveTournamentEntryOutputSchema>

// ─── setTournamentEntryWithdrawn ─────────────────────────────────────────
export const SetTournamentEntryWithdrawnInputSchema = z.object({
    // true = «Снять с турнира» (before the division is drawn), false = return.
    withdrawn: z.boolean(),
    reason: z.string().trim().max(TOURNAMENT_LIMITS.reason).optional(),
})
export const SetTournamentEntryWithdrawnOutputSchema = TournamentEntryRowSchema

export class SetTournamentEntryWithdrawnFeature {
    constructor(
        readonly payload: z.infer<typeof SetTournamentEntryWithdrawnInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly entryId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type SetTournamentEntryWithdrawnFeatureResponse = z.infer<
    typeof SetTournamentEntryWithdrawnOutputSchema
>
