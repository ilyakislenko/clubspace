import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../../shared/utils/optimistic-concurrency'
import {
    DivisionCriteriaFields,
    TOURNAMENT_LIMITS,
    TournamentDivisionListOutputSchema,
    TournamentDivisionOutputSchema,
} from './schemas'

const DivisionNameSchema = z.string().trim().min(1).max(TOURNAMENT_LIMITS.divisionName)
const MatSchema = z.number().int().min(1).max(TOURNAMENT_LIMITS.matCount.max)

// ─── listTournamentDivisions ─────────────────────────────────────────────
export class ListTournamentDivisionsFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListTournamentDivisionsFeatureResponse = z.infer<
    typeof TournamentDivisionListOutputSchema
>

// ─── createTournamentDivisions («Добавить категории») ─────────────────────
export const TournamentDivisionRowInputSchema = z.object({
    // Omitted = generated from the criteria («Мужчины · 18–35 лет · Синий –
    // коричневый · до 76 кг»).
    name: DivisionNameSchema.optional(),
    sex: DivisionCriteriaFields.sex.optional(),
    ageMin: DivisionCriteriaFields.ageMin.optional(),
    ageMax: DivisionCriteriaFields.ageMax.optional(),
    templateId: DivisionCriteriaFields.templateId.optional(),
    levelOrderFrom: DivisionCriteriaFields.levelOrderFrom.optional(),
    levelOrderTo: DivisionCriteriaFields.levelOrderTo.optional(),
    weightMinKg: DivisionCriteriaFields.weightMinKg.optional(),
    weightMaxKg: DivisionCriteriaFields.weightMaxKg.optional(),
})
export const CreateTournamentDivisionsInputSchema = z.object({
    rows: z
        .array(TournamentDivisionRowInputSchema)
        .min(1)
        .max(TOURNAMENT_LIMITS.divisionsPerCall),
})

export class CreateTournamentDivisionsFeature {
    constructor(
        readonly payload: z.infer<typeof CreateTournamentDivisionsInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateTournamentDivisionsFeatureResponse = z.infer<
    typeof TournamentDivisionListOutputSchema
>

// ─── copyTournamentDivisions ─────────────────────────────────────────────
export const CopyTournamentDivisionsInputSchema = z.object({
    // Another tournament of the same org: criteria, names and mats, no entries.
    fromTournamentId: z.string().uuid(),
})

export class CopyTournamentDivisionsFeature {
    constructor(
        readonly payload: z.infer<typeof CopyTournamentDivisionsInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CopyTournamentDivisionsFeatureResponse = z.infer<
    typeof TournamentDivisionListOutputSchema
>

// ─── updateTournamentDivision ────────────────────────────────────────────
export const UpdateTournamentDivisionInputSchema = z
    .object({
        name: DivisionNameSchema.optional(),
        sex: DivisionCriteriaFields.sex.optional(),
        ageMin: DivisionCriteriaFields.ageMin.optional(),
        ageMax: DivisionCriteriaFields.ageMax.optional(),
        templateId: DivisionCriteriaFields.templateId.optional(),
        levelOrderFrom: DivisionCriteriaFields.levelOrderFrom.optional(),
        levelOrderTo: DivisionCriteriaFields.levelOrderTo.optional(),
        weightMinKg: DivisionCriteriaFields.weightMinKg.optional(),
        weightMaxKg: DivisionCriteriaFields.weightMaxKg.optional(),
        // null = no mat («Ковёр не назначен»).
        mat: MatSchema.nullable().optional(),
        matOrder: z.number().int().min(1).max(1000).nullable().optional(),
        ...ExpectedUpdatedAtField,
    })
    .refine(
        ({ expectedUpdatedAt: _version, ...fields }) => Object.keys(fields).length > 0,
        { message: 'Нужно заполнить хотя бы одно поле' },
    )
export const UpdateTournamentDivisionOutputSchema = TournamentDivisionOutputSchema

export class UpdateTournamentDivisionFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateTournamentDivisionInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly divisionId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateTournamentDivisionFeatureResponse = z.infer<
    typeof UpdateTournamentDivisionOutputSchema
>

// ─── deleteTournamentDivision ────────────────────────────────────────────
export const DeleteTournamentDivisionOutputSchema = z.object({ status: z.literal('deleted') })

export class DeleteTournamentDivisionFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly divisionId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteTournamentDivisionFeatureResponse = z.infer<
    typeof DeleteTournamentDivisionOutputSchema
>

// ─── assignTournamentMats («Распределить по коврам») ──────────────────────
export class AssignTournamentMatsFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type AssignTournamentMatsFeatureResponse = z.infer<
    typeof TournamentDivisionListOutputSchema
>
