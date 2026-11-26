import { z } from 'zod'

import {
    CompetitorSexSchema,
    WeightKgSchema,
} from '../../organizations/tournaments/schemas'
import {
    ClubTournamentAthleteSchema,
    ClubTournamentBracketMatchSchema,
    ClubTournamentEntrySchema,
    ClubTournamentOutputSchema,
    ClubTournamentPodiumRowSchema,
} from './schemas'

// ─── getClubTournament ───────────────────────────────────────────────────
export const GetClubTournamentOutputSchema = ClubTournamentOutputSchema

export class GetClubTournamentFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        // The person; a child when a guardian acts for it (X-Act-As).
        readonly invokerUserId: string,
        readonly guardianId: string | null,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetClubTournamentFeatureResponse = z.infer<typeof GetClubTournamentOutputSchema>

// ─── declareTournamentEntry ──────────────────────────────────────────────
export const DeclareTournamentEntryInputSchema = z.object({
    // A coach declaring for a student of their groups (auto-confirmed);
    // omitted = myself (a child when a guardian acts for it).
    userId: z.string().uuid().optional(),
    declaredWeightKg: WeightKgSchema,
    sex: CompetitorSexSchema,
    // Defaults from the profile's birth date; required when it has none.
    birthYear: z.number().int().min(1930).max(2100).optional(),
})
export const DeclareTournamentEntryOutputSchema = ClubTournamentEntrySchema

export class DeclareTournamentEntryFeature {
    constructor(
        readonly payload: z.infer<typeof DeclareTournamentEntryInputSchema>,
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly guardianId: string | null,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeclareTournamentEntryFeatureResponse = z.infer<
    typeof DeclareTournamentEntryOutputSchema
>

// ─── confirmTournamentEntry ──────────────────────────────────────────────
export const ConfirmTournamentEntryInputSchema = z.object({
    // The level when the registry shows none for the athlete (required then).
    templateLevelId: z.string().uuid().optional(),
})
export const ConfirmTournamentEntryOutputSchema = ClubTournamentEntrySchema

export class ConfirmTournamentEntryFeature {
    constructor(
        readonly payload: z.infer<typeof ConfirmTournamentEntryInputSchema>,
        readonly workspaceId: string,
        readonly entryId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ConfirmTournamentEntryFeatureResponse = z.infer<
    typeof ConfirmTournamentEntryOutputSchema
>

// ─── listClubTournamentAthletes ──────────────────────────────────────────
export const ListClubTournamentAthletesOutputSchema = z.object({
    data: z.array(ClubTournamentAthleteSchema),
    toConfirmCount: z.number().int(),
})

export class ListClubTournamentAthletesFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListClubTournamentAthletesFeatureResponse = z.infer<
    typeof ListClubTournamentAthletesOutputSchema
>

// ─── getClubTournamentBracket ────────────────────────────────────────────
export const GetClubTournamentBracketOutputSchema = z.object({
    division: z.object({
        id: z.string().uuid(),
        name: z.string(),
        mat: z.number().int().nullable(),
        drawnAt: z.iso.datetime().nullable(),
        finishedAt: z.iso.datetime().nullable(),
    }),
    size: z.number().int(),
    rounds: z.number().int(),
    matches: z.array(ClubTournamentBracketMatchSchema),
    // A lone athlete (no matches): «без соперника».
    soloWinner: ClubTournamentPodiumRowSchema.nullable(),
})

export class GetClubTournamentBracketFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly divisionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
    ) {}
}
export type GetClubTournamentBracketFeatureResponse = z.infer<
    typeof GetClubTournamentBracketOutputSchema
>

// ─── getClubTournamentResults ────────────────────────────────────────────
export const GetClubTournamentResultsOutputSchema = z.object({
    resultsPublishedAt: z.iso.datetime(),
    divisions: z.array(
        z.object({
            divisionId: z.string().uuid(),
            name: z.string(),
            podium: z.array(ClubTournamentPodiumRowSchema),
        }),
    ),
})

export class GetClubTournamentResultsFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
    ) {}
}
export type GetClubTournamentResultsFeatureResponse = z.infer<
    typeof GetClubTournamentResultsOutputSchema
>
