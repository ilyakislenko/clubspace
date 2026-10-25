import { z } from 'zod'

import { isHttpUrl } from '../../shared/utils/http-url'
import { EventOutputSchema } from './schemas'

// Wall-clock start/end in the form YYYY-MM-DDTHH:MM (seconds optional).
// The admin form types the event time the way the gym hangs it on the
// wall ("14:00") and tags it with the IANA timezone of the place the
// event runs in. The server combines wall-clock + tz to produce the
// absolute UTC instant stored in the DB, and persists the tz alongside
// so everyone later renders the same wall-clock the organiser chose.
const WallClock = z
    .string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
        'Время должно быть в формате YYYY-MM-DDTHH:MM',
    )

export const CreateWorkspaceEventFeatureInputSchema = z
    .object({
        title: z.string().trim().min(1).max(255),
        description: z.string().trim().max(5000).nullable().optional(),
        // z.string().url() accepts javascript:/data: URIs — those are
        // active stored-XSS vectors when the admin renders <a href={…}>.
        // Pin to http(s) so the bad payload never reaches the DB.
        link: z
            .string()
            .url()
            .max(500)
            .refine(isHttpUrl, {
                message: 'Ссылка должна начинаться с http(s)',
            })
            .nullable()
            .optional(),
        startAt: WallClock,
        endAt: WallClock,
        timezone: z.string().min(1).max(64).optional(),
        gymId: z.string().uuid().nullable().optional(),
        coachId: z.string().uuid().nullable().optional(),
    })
    .refine((d) => d.startAt < d.endAt, {
        // String comparison works here because both values use the same
        // fixed-width format YYYY-MM-DDTHH:MM, so lexicographic order
        // mirrors chronological order.
        message: 'Начало должно быть раньше окончания',
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
