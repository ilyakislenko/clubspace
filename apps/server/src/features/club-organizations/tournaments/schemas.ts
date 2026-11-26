import { z } from 'zod'

import {
    CompetitorSexSchema,
    MatchWinMethodSchema,
    TournamentEntryStatusSchema,
    TournamentStatusSchema,
} from '../../organizations/tournaments/schemas'

// Federation tournaments inside a member club's app (design
// docs/design/2026-11-27-tournaments.md §5.2, §2.3). Own data (self, a
// guardian's child, a coach's own students) carries weights and birth year;
// the bracket and results of everyone else never do, and never a user id.

// A person in someone else's view: «Участник скрыт» (`hidden`) without the
// federation consent at the tournament edition or once the club left.
export const ClubTournamentPersonSchema = z.object({
    hidden: z.boolean(),
    personName: z.string().nullable(),
    clubName: z.string().nullable(),
    // The viewer themself (a guardian's child when acting for it).
    isMe: z.boolean(),
    // An athlete of the viewer's club.
    isMyClub: z.boolean(),
})

export const ClubTournamentNextMatchSchema = z.object({
    // null = «Ковёр не назначен».
    mat: z.number().int().nullable(),
    // Matches in front on that mat; null while the opponent is unknown.
    ahead: z.number().int().nullable(),
    opponent: ClubTournamentPersonSchema.nullable(),
    // «ждёт победителя схватки Петров — Сидоров».
    waitingFor: z
        .object({
            entryA: ClubTournamentPersonSchema.nullable(),
            entryB: ClubTournamentPersonSchema.nullable(),
        })
        .nullable(),
})

// An entry as its own people see it (athlete, guardian, own club coach).
export const ClubTournamentEntrySchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    status: TournamentEntryStatusSchema,
    sex: CompetitorSexSchema,
    birthYear: z.number().int(),
    declaredWeightKg: z.number().nullable(),
    weighedWeightKg: z.number().nullable(),
    divisionId: z.string().uuid().nullable(),
    divisionName: z.string().nullable(),
    levelName: z.string().nullable(),
    withdrawnReason: z.string().nullable(),
    // Shown once the division is finished.
    place: z.number().int().nullable(),
    // The division is drawn and the tournament running or finished:
    // «Сетка категории ›».
    bracketAvailable: z.boolean(),
    nextMatch: ClubTournamentNextMatchSchema.nullable(),
    updatedAt: z.iso.datetime(),
})
export type ClubTournamentEntry = z.infer<typeof ClubTournamentEntrySchema>

export const ClubTournamentLevelSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    order: z.number().int(),
    templateId: z.string().uuid(),
    templateName: z.string(),
})

export const ClubTournamentOutputSchema = z.object({
    id: z.string().uuid(),
    eventId: z.string().uuid(),
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    eventTitle: z.string(),
    status: TournamentStatusSchema,
    matCount: z.number().int(),
    resultsPublishedAt: z.iso.datetime().nullable(),
    // The viewer's (or the child's) booking through this club.
    myRegistrationId: z.string().uuid().nullable(),
    myEntry: ClubTournamentEntrySchema.nullable(),
    // SETUP and a booking through this club: «Заявка: укажите вес».
    canDeclare: z.boolean(),
    // The birth year from the profile; null = the entry form asks for it.
    profileBirthYear: z.number().int().nullable(),
    // The person's federation consent covers tournaments (edition ≥
    // 2026-11-27.1); false → OrgConsentSheet with this text first.
    consentCurrent: z.boolean(),
    consentText: z.string(),
    consentVersion: z.string(),
    // Levels of the org standards the divisions use (the coach's picker).
    levels: z.array(ClubTournamentLevelSchema),
    // Staff only: own-scope entries waiting for confirmation; null for members.
    toConfirmCount: z.number().int().nullable(),
})

export const ClubTournamentAthleteSchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    // The student's live booking for the event through this club.
    registrationId: z.string().uuid().nullable(),
    consentCurrent: z.boolean(),
    profileBirthYear: z.number().int().nullable(),
    entry: ClubTournamentEntrySchema.nullable(),
})

export const ClubTournamentBracketMatchSchema = z.object({
    id: z.string().uuid(),
    round: z.number().int(),
    position: z.number().int(),
    isBye: z.boolean(),
    entryA: ClubTournamentPersonSchema.nullable(),
    entryB: ClubTournamentPersonSchema.nullable(),
    winnerSide: z.enum(['A', 'B']).nullable(),
    method: MatchWinMethodSchema.nullable(),
    scoreA: z.number().int().nullable(),
    scoreB: z.number().int().nullable(),
    decidedAt: z.iso.datetime().nullable(),
})

export const ClubTournamentPodiumRowSchema = ClubTournamentPersonSchema.extend({
    place: z.number().int(),
})
