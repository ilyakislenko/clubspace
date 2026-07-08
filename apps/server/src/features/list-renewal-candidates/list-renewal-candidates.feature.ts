import { z } from 'zod'

// A member the club should follow up with about buying a new abonement: their
// class-pack is (nearly) empty, or their access window is about to lapse.
export const RenewalCandidateSchema = z.object({
    userId: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string(),
    // out_of_classes: class-pack at 0. low_classes: 1 class left.
    // access_expiring: access window ends soon (or already has).
    reason: z.enum(['out_of_classes', 'low_classes', 'access_expiring']),
    classesRemaining: z.number().int().nullable(),
    classesTotal: z.number().int().nullable(),
    accessUntil: z.iso.datetime().nullable(),
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
