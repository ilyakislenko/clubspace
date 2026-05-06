import { z } from 'zod'

import { EventOutputSchema } from './schemas'

export const UpdateWorkspaceEventFeatureInputSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    link: z.string().url().max(500).nullable().optional(),
    startAt: z.iso.datetime().optional(),
    endAt: z.iso.datetime().optional(),
    gymId: z.string().uuid().nullable().optional(),
    coachId: z.string().uuid().nullable().optional(),
})

export const UpdateWorkspaceEventFeatureOutputSchema = EventOutputSchema

export class UpdateWorkspaceEventFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateWorkspaceEventFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateWorkspaceEventFeatureResponse = z.infer<
    typeof UpdateWorkspaceEventFeatureOutputSchema
>
