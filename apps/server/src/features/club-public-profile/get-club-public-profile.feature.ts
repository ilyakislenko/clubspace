import { z } from 'zod'

import { ClubPublicProfileSchema } from './schemas'

export const GetClubPublicProfileFeatureOutputSchema = ClubPublicProfileSchema

export class GetClubPublicProfileFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetClubPublicProfileFeatureResponse = z.infer<
    typeof GetClubPublicProfileFeatureOutputSchema
>
