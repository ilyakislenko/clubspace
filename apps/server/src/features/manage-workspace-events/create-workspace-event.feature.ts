import { z } from 'zod'

import { EventOutputSchema } from './schemas'

export const CreateWorkspaceEventFeatureInputSchema = z
    .object({
        title: z.string().trim().min(1).max(255),
        description: z.string().trim().max(5000).nullable().optional(),
        link: z.string().url().max(500).nullable().optional(),
        startAt: z.iso.datetime(),
        endAt: z.iso.datetime(),
        gymId: z.string().uuid().nullable().optional(),
        coachId: z.string().uuid().nullable().optional(),
    })
    .refine((d) => new Date(d.startAt) < new Date(d.endAt), {
        message: 'startAt must be before endAt',
        path: ['startAt'],
    })

export const CreateWorkspaceEventFeatureOutputSchema = EventOutputSchema

export class CreateWorkspaceEventFeature {
    constructor(
        readonly payload: z.infer<
            typeof CreateWorkspaceEventFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type CreateWorkspaceEventFeatureResponse = z.infer<
    typeof CreateWorkspaceEventFeatureOutputSchema
>
