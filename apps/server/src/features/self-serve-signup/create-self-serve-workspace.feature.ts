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
    // The offer + DPA editions the wizard showed (GET /self-serve/config):
    // creating the club accepts them on the club's behalf.
    offerVersion: z.string().trim().min(1).max(64),
    dpaVersion: z.string().trim().min(1).max(64),
})

export const CreateSelfServeWorkspaceOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    status: WorkspaceBillingStatusSchema,
    trialEndsAt: z.iso.datetime().nullable(),
})

export class CreateSelfServeWorkspaceFeature {
    constructor(
        readonly payload: z.infer<typeof CreateSelfServeWorkspaceInputSchema>,
        readonly invokerUserId: string,
        // Evidence of where the offer was accepted, stored on the record.
        readonly ip: string | null = null,
        readonly userAgent: string | null = null,
    ) {}
}

export type CreateSelfServeWorkspaceFeatureResponse = z.infer<
    typeof CreateSelfServeWorkspaceOutputSchema
>
