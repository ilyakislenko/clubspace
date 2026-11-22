import { z } from 'zod'

import { MyVideoNoteSchema } from './schemas'

export const GetMyVideoNoteFeatureOutputSchema = MyVideoNoteSchema

export class GetMyVideoNoteFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
    ) {}
}

export type GetMyVideoNoteFeatureResponse = z.infer<
    typeof GetMyVideoNoteFeatureOutputSchema
>
