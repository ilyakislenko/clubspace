import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../../shared/utils/optimistic-concurrency'
import { OrgEventFields, OrgEventOutputSchema } from './schemas'

export const UpdateOrgEventInputSchema = z
    .object({
        kind: OrgEventFields.kind.optional(),
        title: OrgEventFields.title.optional(),
        description: OrgEventFields.description.optional(),
        startAt: OrgEventFields.startAt.optional(),
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
        publish: OrgEventFields.publish.optional(),
        ...ExpectedUpdatedAtField,
    })
    .refine(
        ({ expectedUpdatedAt: _version, ...fields }) =>
            Object.keys(fields).length > 0,
        { message: 'Нужно заполнить хотя бы одно поле' },
    )
export const UpdateOrgEventOutputSchema = OrgEventOutputSchema

export class UpdateOrgEventFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrgEventInputSchema>,
        readonly organizationId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateOrgEventFeatureResponse = z.infer<typeof UpdateOrgEventOutputSchema>
