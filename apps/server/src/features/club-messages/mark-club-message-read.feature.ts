import { z } from 'zod'

import { MyClubMessageOutputSchema } from './schemas'

export const MarkClubMessageReadOutputSchema = MyClubMessageOutputSchema

export class MarkClubMessageReadFeature {
    constructor(
        readonly workspaceId: string,
        readonly messageId: string,
        readonly userId: string,
    ) {}
}
export type MarkClubMessageReadFeatureResponse = z.infer<typeof MarkClubMessageReadOutputSchema>
