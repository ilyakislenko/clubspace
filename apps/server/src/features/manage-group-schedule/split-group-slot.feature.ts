import { z } from 'zod'

import { SlotOutputSchema, TimeOfDay } from './schemas'

// «Это и все следующие»: the weekly slot changes weekday/time from the dragged
// class on; the classes before it keep the old time.
export const SplitGroupSlotFeatureInputSchema = z.object({
    // The dragged class of this slot.
    fromDate: z.iso.date(),
    // Where that class lands; the following ones shift by the same days.
    newDate: z.iso.date(),
    startTime: TimeOfDay,
    durationMin: z.number().int().min(5).max(24 * 60),
    // Push «Расписание изменилось» to the coaches and members.
    notify: z.boolean().default(true),
})

export const SplitGroupSlotFeatureOutputSchema = z.object({
    // The slot holding the classes from newDate on.
    slot: SlotOutputSchema,
    // The old slot when it was cut (it keeps the earlier classes); null when
    // it was changed in place or merged away.
    previousSlotId: z.string().uuid().nullable(),
    // The series joined a slot of the group that ended the week before.
    merged: z.boolean(),
})

export class SplitGroupSlotFeature {
    constructor(
        readonly payload: z.infer<typeof SplitGroupSlotFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly slotId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SplitGroupSlotFeatureResponse = z.infer<
    typeof SplitGroupSlotFeatureOutputSchema
>
