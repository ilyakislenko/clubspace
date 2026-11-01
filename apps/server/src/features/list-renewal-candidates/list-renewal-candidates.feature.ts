import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'

// A member the club should follow up with about buying a new abonement: a
// class-pack of theirs is (nearly) empty, or an abonement's term / their
// access window is about to lapse (or has) — and they haven't already bought
// the next one of the same scope. One row per member: the most urgent need.
export const RenewalCandidateSchema = z.object({
    userId: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    // out_of_classes: class-pack at 0. low_classes: 1 class left.
    // access_expiring: access window ends soon (or already has).
    reason: z.enum(['out_of_classes', 'low_classes', 'access_expiring']),
    classesRemaining: z.number().int().nullable(),
    classesTotal: z.number().int().nullable(),
    // The member's access window (one per member).
    accessUntil: z.iso.datetime().nullable(),
    // The abonement that needs renewing (null planName = none on record:
    // only the access window lapses). classesRemaining/Total above are its
    // balance while it's current; endDate its own term end.
    planName: z.string().nullable(),
    endDate: z.iso.datetime().nullable(),
    directions: z.array(DirectionRefSchema),
})

export const ListRenewalCandidatesOutputSchema = z.object({
    data: z.array(RenewalCandidateSchema),
})

export class ListRenewalCandidatesFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListRenewalCandidatesFeatureResponse = z.infer<
    typeof ListRenewalCandidatesOutputSchema
>
