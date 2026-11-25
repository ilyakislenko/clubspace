import { z } from 'zod'

import { OrgEventOutputSchema } from './schemas'

export const GetOrgEventOutputSchema = OrgEventOutputSchema

export class GetOrgEventFeature {
    constructor(
        readonly organizationId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetOrgEventFeatureResponse = z.infer<typeof GetOrgEventOutputSchema>
