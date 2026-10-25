import { z } from 'zod'

import { PersonalTrainingOutputSchema } from './schemas'

// Wall-clock start in the request's zone, YYYY-MM-DDTHH:MM (seconds optional).
export const WallClock = z
    .string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
        'Время должно быть в формате YYYY-MM-DDTHH:MM',
    )

export const ProposedTimeSchema = z.object({
    startAt: WallClock,
    durationMin: z.number().int().min(30).max(180),
})

export const RequestPersonalTrainingInputSchema = z.object({
    coachId: z.string().uuid(),
    gymId: z.string().uuid().nullable().optional(),
    options: z.array(ProposedTimeSchema).min(1).max(3),
    comment: z.string().trim().max(500).optional(),
})

export const RequestPersonalTrainingOutputSchema = PersonalTrainingOutputSchema

export class RequestPersonalTrainingFeature {
    constructor(
        readonly payload: z.infer<typeof RequestPersonalTrainingInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type RequestPersonalTrainingFeatureResponse = z.infer<
    typeof RequestPersonalTrainingOutputSchema
>
