import { z } from 'zod'

export const DeleteOrgEventOutputSchema = z.object({ status: z.literal('deleted') })

export class DeleteOrgEventFeature {
    constructor(
        readonly organizationId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteOrgEventFeatureResponse = z.infer<typeof DeleteOrgEventOutputSchema>
