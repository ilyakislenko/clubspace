import { z } from 'zod'

import { DirectionListOutputSchema } from './schemas'

export const ListDirectionsOutputSchema = DirectionListOutputSchema

export class ListDirectionsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListDirectionsFeatureResponse = z.infer<
    typeof ListDirectionsOutputSchema
>
