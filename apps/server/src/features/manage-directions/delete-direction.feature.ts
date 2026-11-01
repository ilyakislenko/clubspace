import { z } from 'zod'

import { DirectionDeletedOutputSchema } from './schemas'

export const DeleteDirectionOutputSchema = DirectionDeletedOutputSchema

export class DeleteDirectionFeature {
    constructor(
        readonly workspaceId: string,
        readonly directionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteDirectionFeatureResponse = z.infer<
    typeof DeleteDirectionOutputSchema
>
