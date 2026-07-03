import { z } from 'zod'

import { PlanDeletedOutputSchema } from './schemas'

export const DeletePlanOutputSchema = PlanDeletedOutputSchema

export class DeletePlanFeature {
    constructor(
        readonly workspaceId: string,
        readonly planId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeletePlanFeatureResponse = z.infer<typeof DeletePlanOutputSchema>
