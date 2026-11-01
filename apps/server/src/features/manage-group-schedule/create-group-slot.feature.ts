import { z } from 'zod'

import { SlotOutputSchema, TimeOfDay } from './schemas'

export const CreateGroupSlotFeatureInputSchema = z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: TimeOfDay,
    durationMin: z.number().int().min(5).max(24 * 60),
    effectiveFrom: z.iso.date().optional().nullable(),
    effectiveUntil: z.iso.date().optional().nullable(),
    // Spots per class of this slot («Запись на занятие»); null = the group's.
    capacity: z.number().int().min(1).max(1000).nullable().optional(),
})

export const CreateGroupSlotFeatureOutputSchema = SlotOutputSchema

export class CreateGroupSlotFeature {
    constructor(
        readonly payload: z.infer<typeof CreateGroupSlotFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateGroupSlotFeatureResponse = z.infer<
    typeof CreateGroupSlotFeatureOutputSchema
>
