import { z } from 'zod'

import { PLATFORM_MODULE_CODES } from '../../domains/billing/platform-pricing.config'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// A paid module for one club. mode DEFAULT removes the platform's setting
// (on during the trial, off afterwards); PAID puts it on the bill (optionally
// at a custom monthly price); COMP grants it free through compUntil
// (inclusive, Moscow) and then it switches off; OFF switches it off even
// during the trial.
export const UpdatePlatformWorkspaceModuleInputSchema = z
    .object({
        module: z.enum(PLATFORM_MODULE_CODES),
        mode: z.enum(['PAID', 'COMP', 'OFF', 'DEFAULT']),
        compUntil: z.iso.date().optional(),
        // PAID only; null = the configured price.
        customPrice: z.number().int().min(0).max(10_000_000).nullable().optional(),
    })
    .superRefine((v, ctx) => {
        if (v.mode === 'COMP' && !v.compUntil) {
            ctx.addIssue({
                code: 'custom',
                path: ['compUntil'],
                message: 'Укажите, до какого числа модуль бесплатен',
            })
        }
    })

export const UpdatePlatformWorkspaceModuleOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class UpdatePlatformWorkspaceModuleFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: z.infer<typeof UpdatePlatformWorkspaceModuleInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdatePlatformWorkspaceModuleFeatureResponse = z.infer<
    typeof UpdatePlatformWorkspaceModuleOutputSchema
>
