import { z } from 'zod'

import { OrgEventFields, OrgEventOutputSchema } from './schemas'

export const CreateOrgEventInputSchema = z.object({
    kind: OrgEventFields.kind.optional(),
    title: OrgEventFields.title,
    description: OrgEventFields.description.optional(),
    startAt: OrgEventFields.startAt,
    endAt: OrgEventFields.endAt.optional(),
    timezone: OrgEventFields.timezone.optional(),
    place: OrgEventFields.place.optional(),
    address: OrgEventFields.address.optional(),
    hostClubId: OrgEventFields.hostClubId.optional(),
    audience: OrgEventFields.audience.optional(),
    capacity: OrgEventFields.capacity.optional(),
    registrationOpen: OrgEventFields.registrationOpen.optional(),
    registrationClosesAt: OrgEventFields.registrationClosesAt.optional(),
    feeNote: OrgEventFields.feeNote.optional(),
    // Default true: clubs see it at once.
    publish: OrgEventFields.publish.optional(),
})
export const CreateOrgEventOutputSchema = OrgEventOutputSchema

export class CreateOrgEventFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrgEventInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateOrgEventFeatureResponse = z.infer<typeof CreateOrgEventOutputSchema>
