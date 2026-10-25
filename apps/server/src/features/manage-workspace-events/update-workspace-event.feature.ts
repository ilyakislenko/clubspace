import { z } from 'zod'

import { isHttpUrl } from '../../shared/utils/http-url'
import { EventOutputSchema } from './schemas'

const WallClock = z
    .string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
        'Время должно быть в формате YYYY-MM-DDTHH:MM',
    )

export const UpdateWorkspaceEventFeatureInputSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    // Mirror create-workspace-event: reject any non-http(s) scheme so
    // javascript:/data: URIs cannot be persisted via the edit path.
    link: z
        .string()
        .url()
        .max(500)
        .refine(isHttpUrl, {
            message: 'Ссылка должна начинаться с http(s)',
        })
        .nullable()
        .optional(),
    // Same wall-clock + timezone semantics as create. If the admin
    // changes the timezone, both startAt and endAt are reinterpreted in
    // the new zone (handler computes UTC again from the wall-clock
    // already on the row).
    startAt: WallClock.optional(),
    endAt: WallClock.optional(),
    timezone: z.string().min(1).max(64).optional(),
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
