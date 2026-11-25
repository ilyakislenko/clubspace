import { z } from 'zod'

import { CheckInCardSchema } from './schemas'

export const GetMyCheckInCardOutputSchema = CheckInCardSchema

// The caller's own card in this club; under X-Act-As the child's.
export class GetMyCheckInCardFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyCheckInCardFeatureResponse = z.infer<
    typeof GetMyCheckInCardOutputSchema
>
