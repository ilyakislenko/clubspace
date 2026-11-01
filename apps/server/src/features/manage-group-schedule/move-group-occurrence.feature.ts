import { z } from 'zod'

import { TimeOfDay } from './schemas'

// «Только это занятие»: one dated class of a slot goes to another date/time.
export const MoveGroupOccurrenceFeatureInputSchema = z.object({
    newDate: z.iso.date(),
    startTime: TimeOfDay,
    durationMin: z.number().int().min(5).max(24 * 60),
    // Push «Занятие перенесено» to the coaches and the class's members.
    notify: z.boolean().default(true),
})

export const MoveGroupOccurrenceFeatureOutputSchema = z.object({
    // The slot now holding the class (a one-off, or the origin on restore).
    slotId: z.string().uuid(),
    // The class's date on that slot.
    sessionDate: z.iso.date(),
    // The class went back onto its original slot, date and time.
    restored: z.boolean(),
})

export class MoveGroupOccurrenceFeature {
    constructor(
        readonly payload: z.infer<typeof MoveGroupOccurrenceFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly slotId: string,
        readonly sessionDate: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type MoveGroupOccurrenceFeatureResponse = z.infer<
    typeof MoveGroupOccurrenceFeatureOutputSchema
>
