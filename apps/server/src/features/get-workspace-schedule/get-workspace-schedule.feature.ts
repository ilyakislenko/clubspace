import { z } from 'zod'

import { EventOutputSchema } from '../manage-workspace-events/schemas'

export const GetWorkspaceScheduleFeatureInputSchema = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
})

const SessionSchema = z.object({
    // Synthetic — combines slotId with the calendar date so the client
    // can use it as a stable React key when rendering. Not a DB row.
    occurrenceId: z.string(),
    slotId: z.string().uuid(),
    groupId: z.string().uuid(),
    group: z.object({
        id: z.string().uuid(),
        name: z.string(),
        gym: z
            .object({
                id: z.string().uuid(),
                name: z.string(),
                address: z.string(),
            })
            .nullable(),
        coach: z.object({
            id: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
        }),
    }),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    durationMin: z.number().int(),
    dayOfWeek: z.number().int(),
    // IANA timezone the wall-clock for this occurrence lives in. Equal
    // to gym.timezone when the group has one, else workspace.timezone.
    timezone: z.string(),
    cancelled: z.boolean(),
    cancellationReason: z.string().nullable(),
})

export const GetWorkspaceScheduleFeatureOutputSchema = z.object({
    timezone: z.string(),
    sessions: z.array(SessionSchema),
    events: z.array(EventOutputSchema),
})

export class GetWorkspaceScheduleFeature {
    constructor(
        readonly payload: z.infer<
            typeof GetWorkspaceScheduleFeatureInputSchema
        >,
        readonly workspaceId: string,
    ) {}
}

export type GetWorkspaceScheduleFeatureResponse = z.infer<
    typeof GetWorkspaceScheduleFeatureOutputSchema
>
