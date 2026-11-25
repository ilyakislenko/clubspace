import { z } from 'zod'

import { MyClubMessageOutputSchema } from './schemas'

export const GetMyClubMessageOutputSchema = MyClubMessageOutputSchema

export class GetMyClubMessageFeature {
    constructor(
        readonly workspaceId: string,
        readonly messageId: string,
        readonly userId: string,
    ) {}
}
export type GetMyClubMessageFeatureResponse = z.infer<typeof GetMyClubMessageOutputSchema>
