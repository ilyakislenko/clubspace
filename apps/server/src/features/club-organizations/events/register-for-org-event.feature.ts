import { z } from 'zod'

export const RegisterForOrgEventInputSchema = z.object({
    // A coach registering a student of their groups; omitted = myself (a
    // child when a guardian acts for it).
    userId: z.string().uuid().optional(),
})
export const OrgEventRegistrationRefOutputSchema = z.object({
    id: z.string().uuid(),
    eventId: z.string().uuid(),
    status: z.enum(['BOOKED', 'CANCELLED']),
    bookedCount: z.number().int(),
})

export class RegisterForOrgEventFeature {
    constructor(
        readonly payload: z.infer<typeof RegisterForOrgEventInputSchema>,
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        // The guardian acting for the child (X-Act-As), else null.
        readonly guardianId: string | null,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RegisterForOrgEventFeatureResponse = z.infer<
    typeof OrgEventRegistrationRefOutputSchema
>
