import { z } from 'zod'

// Federation tournaments, org console side (design
// docs/design/2026-11-27-tournaments.md §5.1). Weights travel as kg with one
// decimal; the database keeps grams.

export const TournamentStatusSchema = z.enum(['SETUP', 'WEIGH_IN', 'RUNNING', 'FINISHED'])
export const CompetitorSexSchema = z.enum(['FEMALE', 'MALE'])
export const TournamentEntryStatusSchema = z.enum(['DECLARED', 'CONFIRMED', 'WITHDRAWN'])
// Labels come from the org-type vocabulary (GRAPPLING: «Болевой/удушающий ·
// По очкам · Решение судей · Дисквалификация · Неявка»).
export const MatchWinMethodSchema = z.enum([
    'FINISH',
    'POINTS',
    'DECISION',
    'DISQUALIFICATION',
    'WALKOVER',
])

export const TOURNAMENT_LIMITS = {
    divisionName: 120,
    divisionsPerCall: 60,
    divisionsPerTournament: 200,
    entriesPerDivision: 64,
    matCount: { min: 1, max: 12 },
    weightKg: { min: 10, max: 250 },
    age: { min: 3, max: 99 },
    score: { min: 0, max: 999 },
    note: 120,
    reason: 120,
} as const

// 10.0–250.0 kg, step 0.1.
export const WeightKgSchema = z
    .number()
    .min(TOURNAMENT_LIMITS.weightKg.min)
    .max(TOURNAMENT_LIMITS.weightKg.max)
    .refine((kg) => Math.abs(kg * 10 - Math.round(kg * 10)) < 1e-6, {
        message: 'Вес указывается с точностью до 0,1 кг',
    })

export const MatCountSchema = z
    .number()
    .int()
    .min(TOURNAMENT_LIMITS.matCount.min)
    .max(TOURNAMENT_LIMITS.matCount.max)

const AgeSchema = z.number().int().min(TOURNAMENT_LIMITS.age.min).max(TOURNAMENT_LIMITS.age.max)
const LevelOrderSchema = z.number().int().min(0).max(1000)

// Division criteria shared by create, update and copy.
export const DivisionCriteriaFields = {
    // null = mixed.
    sex: CompetitorSexSchema.nullable(),
    // Inclusive, by birth year (event year − birth year); null = no bound.
    ageMin: AgeSchema.nullable(),
    ageMax: AgeSchema.nullable(),
    // One of the org's standards; null = any level.
    templateId: z.string().uuid().nullable(),
    // Inclusive range of the standard's level `order`.
    levelOrderFrom: LevelOrderSchema.nullable(),
    levelOrderTo: LevelOrderSchema.nullable(),
    // Lower bound exclusive, upper inclusive; both null = open weight.
    weightMinKg: WeightKgSchema.nullable(),
    weightMaxKg: WeightKgSchema.nullable(),
}

export const OrgTournamentOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    eventId: z.string().uuid(),
    event: z.object({
        title: z.string(),
        startAt: z.iso.datetime(),
        endAt: z.iso.datetime().nullable(),
        timezone: z.string(),
        place: z.string().nullable(),
        // The org-local date of the start (age by birth year counts from its year).
        localDate: z.iso.date(),
    }),
    status: TournamentStatusSchema,
    matCount: z.number().int(),
    resultsPublishedAt: z.iso.datetime().nullable(),
    counts: z.object({
        // BOOKED registrations of the event.
        registrations: z.number().int(),
        declared: z.number().int(),
        confirmed: z.number().int(),
        withdrawn: z.number().int(),
        // Confirmed, weighed (status line «взвешено 46 из 52»).
        weighed: z.number().int(),
        // Confirmed, not weighed yet (become WITHDRAWN «Не взвешен» at the start).
        unweighed: z.number().int(),
        // Confirmed without a division (the start is refused while one is weighed).
        unassigned: z.number().int(),
        divisions: z.number().int(),
        divisionsDrawn: z.number().int(),
        divisionsFinished: z.number().int(),
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type OrgTournamentOutput = z.infer<typeof OrgTournamentOutputSchema>

// NOT_DRAWN «нет сетки» · DRAWN «сетка» · RUNNING «идёт» (a result is in) ·
// FINISHED «итоги».
export const DivisionStateSchema = z.enum(['NOT_DRAWN', 'DRAWN', 'RUNNING', 'FINISHED'])

export const TournamentDivisionOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    sortOrder: z.number().int(),
    sex: CompetitorSexSchema.nullable(),
    ageMin: z.number().int().nullable(),
    ageMax: z.number().int().nullable(),
    templateId: z.string().uuid().nullable(),
    levelOrderFrom: z.number().int().nullable(),
    levelOrderTo: z.number().int().nullable(),
    levelLabel: z.string().nullable(),
    weightMinKg: z.number().nullable(),
    weightMaxKg: z.number().nullable(),
    mat: z.number().int().nullable(),
    matOrder: z.number().int().nullable(),
    drawNo: z.number().int(),
    drawnAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    // Entries in it that aren't withdrawn.
    entryCount: z.number().int(),
    // Any non-bye match decided: redraw and moves are refused.
    hasResults: z.boolean(),
    state: DivisionStateSchema,
    updatedAt: z.iso.datetime(),
})
export type TournamentDivisionOutput = z.infer<typeof TournamentDivisionOutputSchema>

export const TournamentDivisionListOutputSchema = z.object({
    data: z.array(TournamentDivisionOutputSchema),
})

// One athlete in the console. A person without a live federation consent at
// the tournament edition, or whose club left the org, is «Участник скрыт»:
// `hidden`, no name and no club.
export const TournamentEntryRowSchema = z.object({
    id: z.string().uuid(),
    hidden: z.boolean(),
    personName: z.string().nullable(),
    clubId: z.string().uuid().nullable(),
    clubName: z.string().nullable(),
    status: TournamentEntryStatusSchema,
    sex: CompetitorSexSchema,
    birthYear: z.number().int(),
    declaredWeightKg: z.number().nullable(),
    weighedWeightKg: z.number().nullable(),
    weighedAt: z.iso.datetime().nullable(),
    divisionId: z.string().uuid().nullable(),
    divisionName: z.string().nullable(),
    // The level snapshot at confirmation; `levelPickedByCoach` = not from the registry.
    levelName: z.string().nullable(),
    levelPickedByCoach: z.boolean(),
    // The current weight (weighed, else declared) fits its division; null
    // without a division or a weight.
    fits: z.boolean().nullable(),
    withdrawnReason: z.string().nullable(),
    place: z.number().int().nullable(),
    updatedAt: z.iso.datetime(),
})
export type TournamentEntryRow = z.infer<typeof TournamentEntryRowSchema>

// One side of a match. `hidden` = «Участник скрыт» (no name, no club).
export const TournamentCompetitorSchema = z.object({
    entryId: z.string().uuid(),
    hidden: z.boolean(),
    personName: z.string().nullable(),
    clubName: z.string().nullable(),
    place: z.number().int().nullable(),
})

export const TournamentMatchOutputSchema = z.object({
    id: z.string().uuid(),
    divisionId: z.string().uuid(),
    round: z.number().int(),
    position: z.number().int(),
    // A bye: the athlete passes without a match («проходит без схватки»).
    isBye: z.boolean(),
    entryA: TournamentCompetitorSchema.nullable(),
    entryB: TournamentCompetitorSchema.nullable(),
    winnerEntryId: z.string().uuid().nullable(),
    method: MatchWinMethodSchema.nullable(),
    scoreA: z.number().int().nullable(),
    scoreB: z.number().int().nullable(),
    note: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    // Both athletes known, undecided, not a bye.
    ready: z.boolean(),
    // Where the winner goes (null for the final); the undo confirm names it.
    nextMatchId: z.string().uuid().nullable(),
    // Send back as expectedUpdatedAt when recording / undoing.
    updatedAt: z.iso.datetime(),
})
export type TournamentMatchOutput = z.infer<typeof TournamentMatchOutputSchema>

export const TournamentBracketOutputSchema = z.object({
    division: TournamentDivisionOutputSchema,
    // Slots (a power of two) and rounds; 1 slot = a lone athlete, no matches.
    size: z.number().int(),
    rounds: z.number().int(),
    matches: z.array(TournamentMatchOutputSchema),
    // Before the draw: the athletes waiting in the division.
    entries: z.array(TournamentCompetitorSchema),
})
export type TournamentBracketOutput = z.infer<typeof TournamentBracketOutputSchema>

export const TournamentQueueMatchSchema = TournamentMatchOutputSchema.extend({
    divisionName: z.string(),
})

export const TournamentMatQueueOutputSchema = z.object({
    mat: z.number().int(),
    // The match on the mat now, then the next 5.
    current: TournamentQueueMatchSchema.nullable(),
    next: z.array(TournamentQueueMatchSchema),
    // Drawn divisions with matches left but no mat («Ковёр не назначен»).
    unassignedDivisions: z.number().int(),
})

export const TournamentPodiumRowSchema = z.object({
    place: z.number().int(),
    entryId: z.string().uuid(),
    hidden: z.boolean(),
    personName: z.string().nullable(),
    clubName: z.string().nullable(),
})

export const TournamentResultsOutputSchema = z.object({
    status: TournamentStatusSchema,
    resultsPublishedAt: z.iso.datetime().nullable(),
    divisions: z.array(
        z.object({
            divisionId: z.string().uuid(),
            name: z.string(),
            drawn: z.boolean(),
            finished: z.boolean(),
            // 1 · 2 · 3 · 3 (fewer in small divisions or after a walkover).
            podium: z.array(TournamentPodiumRowSchema),
        }),
    ),
})
