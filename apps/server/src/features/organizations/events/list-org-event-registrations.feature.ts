import { z } from 'zod'

export const OrgEventRegistrationOutputSchema = z.object({
    id: z.string().uuid(),
    personName: z.string(),
    clubId: z.string().uuid(),
    clubName: z.string(),
    status: z.enum(['BOOKED', 'CANCELLED']),
    // SELF «сам» (the person or their guardian), COACH «записал тренер».
    bookedBy: z.enum(['SELF', 'COACH']),
    // The newest belt, only when the person is visible in the registry.
    belt: z
        .object({
            levelName: z.string(),
            levelColor: z.string().nullable(),
            stripes: z.number().int(),
            ladderName: z.string(),
        })
        .nullable(),
    createdAt: z.iso.datetime(),
})

export const ListOrgEventRegistrationsOutputSchema = z.object({
    data: z.array(OrgEventRegistrationOutputSchema),
    // Places held by people whose consent was withdrawn or whose club left:
    // counted, never named.
    hiddenCount: z.number().int(),
})

export class ListOrgEventRegistrationsFeature {
    constructor(
        readonly organizationId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListOrgEventRegistrationsFeatureResponse = z.infer<
    typeof ListOrgEventRegistrationsOutputSchema
>
