import { z } from 'zod'

import { ClubAboutOutputSchema } from './schemas'

export const GetClubAboutFeatureOutputSchema = ClubAboutOutputSchema

export class GetClubAboutFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetClubAboutFeatureResponse = z.infer<
    typeof GetClubAboutFeatureOutputSchema
>
