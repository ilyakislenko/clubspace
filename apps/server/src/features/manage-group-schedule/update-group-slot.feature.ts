import { z } from 'zod'

import { SlotOutputSchema, TimeOfDay } from './schemas'

export const UpdateGroupSlotFeatureInputSchema = z.object({
    dayOfWeek: z.number().int().min(1).max(7).optional(),
    startTime: TimeOfDay.optional(),
    durationMin: z.number().int().min(5).max(24 * 60).optional(),
    effectiveFrom: z.iso.date().nullable().optional(),
    effectiveUntil: z.iso.date().nullable().optional(),
})

export const UpdateGroupSlotFeatureOutputSchema = SlotOutputSchema

export class UpdateGroupSlotFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateGroupSlotFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly slotId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateGroupSlotFeatureResponse = z.infer<
    typeof UpdateGroupSlotFeatureOutputSchema
>
