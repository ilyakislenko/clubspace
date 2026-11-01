import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'

export const GetMyAgendaInputSchema = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
})

// One flat shape for every kind (no unions in DTOs): the ref fields that do not
// apply to a kind are null. Every item names its club so the app can switch to
// it before opening the item.
export const AgendaItemOutputSchema = z.object({
    // Stable key: `<kind>:<ref>`.
    id: z.string(),
    kind: z.enum(['class', 'event', 'dropIn', 'personalTraining']),
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    title: z.string(),
    // Gym for classes and events, the other person for a personal training.
    subtitle: z.string().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    // IANA zone the club entered the time in; `date` is the local day there.
    timezone: z.string(),
    date: z.iso.date(),
    cancelled: z.boolean(),
    cancellationReason: z.string().nullable(),
    // 'coach' when the caller runs the class / personal training.
    myRole: z.enum(['member', 'coach']),
    groupId: z.string().uuid().nullable(),
    slotId: z.string().uuid().nullable(),
    // `<slotId>:<yyyy-mm-dd>` for classes and drop-ins (the schedule's key).
    occurrenceId: z.string().nullable(),
    eventId: z.string().uuid().nullable(),
    personalTrainingId: z.string().uuid().nullable(),
    // Discipline of the class / event (the app's direction filter); null for
    // club-wide items and personal trainings.
    direction: DirectionRefSchema.nullable(),
})

export const GetMyAgendaOutputSchema = z.object({
    items: z.array(AgendaItemOutputSchema),
})

export class GetMyAgendaFeature {
    constructor(
        readonly payload: z.infer<typeof GetMyAgendaInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type AgendaItem = z.infer<typeof AgendaItemOutputSchema>
export type GetMyAgendaFeatureResponse = z.infer<typeof GetMyAgendaOutputSchema>
