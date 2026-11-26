import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../../shared/utils/optimistic-concurrency'
import { MatCountSchema, OrgTournamentOutputSchema } from './schemas'

// ─── createOrgTournament ─────────────────────────────────────────────────
export const CreateOrgTournamentInputSchema = z.object({
    matCount: MatCountSchema.optional(),
})
export const CreateOrgTournamentOutputSchema = OrgTournamentOutputSchema

export class CreateOrgTournamentFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrgTournamentInputSchema>,
        readonly organizationId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateOrgTournamentFeatureResponse = z.infer<typeof CreateOrgTournamentOutputSchema>

// ─── getOrgTournament ────────────────────────────────────────────────────
export const GetOrgTournamentOutputSchema = OrgTournamentOutputSchema

export class GetOrgTournamentFeature {
    constructor(
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetOrgTournamentFeatureResponse = z.infer<typeof GetOrgTournamentOutputSchema>

// ─── updateOrgTournament ─────────────────────────────────────────────────
export const UpdateOrgTournamentInputSchema = z.object({
    matCount: MatCountSchema,
    ...ExpectedUpdatedAtField,
})
export const UpdateOrgTournamentOutputSchema = OrgTournamentOutputSchema

export class UpdateOrgTournamentFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrgTournamentInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateOrgTournamentFeatureResponse = z.infer<typeof UpdateOrgTournamentOutputSchema>

// ─── setOrgTournamentStatus ──────────────────────────────────────────────
// SETUP ↔ WEIGH_IN → RUNNING (one way; RUNNING withdraws the unweighed and
// draws every undrawn division). FINISHED only through the publication.
export const SetOrgTournamentStatusInputSchema = z.object({
    status: z.enum(['SETUP', 'WEIGH_IN', 'RUNNING']),
})
export const SetOrgTournamentStatusOutputSchema = OrgTournamentOutputSchema

export class SetOrgTournamentStatusFeature {
    constructor(
        readonly payload: z.infer<typeof SetOrgTournamentStatusInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type SetOrgTournamentStatusFeatureResponse = z.infer<
    typeof SetOrgTournamentStatusOutputSchema
>

// ─── publishOrgTournamentResults ─────────────────────────────────────────
// true: RUNNING → FINISHED (every drawn division finished); false: back to RUNNING.
export const PublishOrgTournamentResultsInputSchema = z.object({
    published: z.boolean(),
})
export const PublishOrgTournamentResultsOutputSchema = OrgTournamentOutputSchema

export class PublishOrgTournamentResultsFeature {
    constructor(
        readonly payload: z.infer<typeof PublishOrgTournamentResultsInputSchema>,
        readonly organizationId: string,
        readonly tournamentId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type PublishOrgTournamentResultsFeatureResponse = z.infer<
    typeof PublishOrgTournamentResultsOutputSchema
>
