import { z } from 'zod'

import type { OnboardingHelpRequest } from '../../infrastructure/prisma'

// Where the setup fee — what pays for the platform's hands-on help — stands:
// waived by the platform, paid with the first period, or still ahead (it goes
// with the first paid period, never during the trial).
export const SetupFeeStateSchema = z.object({
    amount: z.number().int(),
    state: z.enum(['PAID', 'WAIVED', 'DUE']),
})

export const OnboardingHelpRequestSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    status: z.enum(['OPEN', 'DONE', 'CANCELED']),
    requesterName: z.string(),
    requesterEmail: z.string().nullable(),
    phone: z.string().nullable(),
    message: z.string().nullable(),
    // The platform's note when it closed the request.
    resolution: z.string().nullable(),
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
    setupFee: SetupFeeStateSchema,
})

export type SetupFeeState = z.infer<typeof SetupFeeStateSchema>

export const setupFeeState = (
    billing: { setupFeeWaived: boolean; setupFeePaidAt: Date | null } | null,
    amount: number,
): SetupFeeState => ({
    amount,
    state: billing?.setupFeeWaived
        ? 'WAIVED'
        : billing?.setupFeePaidAt
          ? 'PAID'
          : 'DUE',
})

export const serializeOnboardingHelpRequest = (
    row: OnboardingHelpRequest & { workspace: { name: string } },
    setupFee: SetupFeeState,
): z.infer<typeof OnboardingHelpRequestSchema> => ({
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspace.name,
    status: row.status,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    phone: row.phone,
    message: row.message,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    setupFee,
})
