import { z } from 'zod'

import { WorkspaceTypeSchema } from '../platform/schemas'
import { WorkspaceBillingStatusSchema } from '../workspace-billing/schemas'

const isIanaTimezone = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

export const CreateSelfServeWorkspaceInputSchema = z.object({
    name: z.string().trim().min(2).max(255),
    type: WorkspaceTypeSchema,
    timezone: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .refine(isIanaTimezone, { message: 'Неизвестный часовой пояс' }),
    city: z.string().trim().max(120).optional(),
})

export const CreateSelfServeWorkspaceOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    status: WorkspaceBillingStatusSchema,
    planName: z.string(),
    trialEndsAt: z.iso.datetime().nullable(),
})

export class CreateSelfServeWorkspaceFeature {
    constructor(
        readonly payload: z.infer<typeof CreateSelfServeWorkspaceInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type CreateSelfServeWorkspaceFeatureResponse = z.infer<
    typeof CreateSelfServeWorkspaceOutputSchema
>
