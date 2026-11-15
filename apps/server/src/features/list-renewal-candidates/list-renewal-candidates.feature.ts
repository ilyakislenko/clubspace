import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import { RENEWAL_REASONS } from '../../domains/subscriptions/renewal-rules'
import { AnalyticsFilterSchema } from '../club-analytics/schemas'
import { MemberGuardianSchema } from '../dependents/schemas'

export const RENEWALS_DEFAULT_PER_PAGE = 50
export const RENEWALS_MAX_PER_PAGE = 200

// «Продлить». Gym / direction / group / coach narrow the list to the members
// of the matching groups (an id from another club is a 404).
export const ListRenewalCandidatesInputSchema = AnalyticsFilterSchema.extend({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce
        .number()
        .int()
        .positive()
        .max(RENEWALS_MAX_PER_PAGE)
        .optional(),
})

export type ListRenewalCandidatesInput = z.infer<
    typeof ListRenewalCandidatesInputSchema
>

// A member the club should follow up with about buying a new abonement
// (domains/subscriptions/renewal-rules: renewalNeed). One row per member: the
// most urgent need.
export const RenewalCandidateSchema = z.object({
    userId: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    // A child profile's contacts.
    guardians: z.array(MemberGuardianSchema),
    // out_of_classes: class-pack at 0. low_classes: 1 class left.
    // access_expiring: the term / access window ends soon (or just ended).
    reason: z.enum(RENEWAL_REASONS),
    classesRemaining: z.number().int().nullable(),
    classesTotal: z.number().int().nullable(),
    // The member's access window (one per member).
    accessUntil: z.iso.datetime().nullable(),
    // The abonement that needs renewing (null planId/planName = none on
    // record: only the access window lapses). classesRemaining/Total above
    // are its balance while it's current; endDate its own term end.
    planId: z.string().uuid().nullable(),
    planName: z.string().nullable(),
    endDate: z.iso.datetime().nullable(),
    directions: z.array(DirectionRefSchema),
    // The member's autopay renews this abonement (status, next charge day;
    // null day = stopped, waits for the member): staff don't call someone
    // covered by it. null = no live agreement for it.
    autopay: z
        .object({
            status: z.enum(['ACTIVE', 'NEEDS_ACTION']),
            nextChargeOn: z.iso.date().nullable(),
        })
        .nullable(),
})

export const ListRenewalCandidatesOutputSchema = z.object({
    data: z.array(RenewalCandidateSchema),
    // Members matching the filters, across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListRenewalCandidatesFeature {
    constructor(
        readonly payload: ListRenewalCandidatesInput,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListRenewalCandidatesFeatureResponse = z.infer<
    typeof ListRenewalCandidatesOutputSchema
>
