import { z } from 'zod'

export const OrgEventStudentOutputSchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    // Consented to this federation: may be registered.
    consented: z.boolean(),
    registration: z
        .object({
            id: z.string().uuid(),
            status: z.enum(['BOOKED', 'CANCELLED']),
            // The caller may give the place back (cancelOrgEventRegistration's
            // rule: they booked it through this club); else the row is inert.
            canCancel: z.boolean(),
        })
        .nullable(),
})
export const ListOrgEventStudentsOutputSchema = z.object({
    data: z.array(OrgEventStudentOutputSchema),
})

export class ListOrgEventStudentsFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListOrgEventStudentsFeatureResponse = z.infer<
    typeof ListOrgEventStudentsOutputSchema
>
