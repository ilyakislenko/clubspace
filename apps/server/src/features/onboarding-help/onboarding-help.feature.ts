import { z } from 'zod'

import { OnboardingHelpRequestSchema, SetupFeeStateSchema } from './schemas'

// «Запросить помощь с подключением»: the club asks the platform's team to set
// it up by hand. A paid service — the setup fee, charged with the first paid
// period (the console may waive it with the «без платы за подключение» promo).
// The request only lands in the platform console: no work starts by itself.

// GET /workspaces/:workspaceId/onboarding-help
export const GetWorkspaceOnboardingHelpOutputSchema = z.object({
    // The club's latest request (any status), or null.
    request: OnboardingHelpRequestSchema.nullable(),
    setupFee: SetupFeeStateSchema,
})
export class GetWorkspaceOnboardingHelpFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetWorkspaceOnboardingHelpFeatureResponse = z.infer<
    typeof GetWorkspaceOnboardingHelpOutputSchema
>

// POST /workspaces/:workspaceId/onboarding-help — an open request is updated
// rather than doubled.
export const RequestWorkspaceOnboardingHelpInputSchema = z.object({
    phone: z.string().trim().max(32).optional(),
    message: z.string().trim().max(2000).optional(),
})
export const RequestWorkspaceOnboardingHelpOutputSchema = GetWorkspaceOnboardingHelpOutputSchema
export class RequestWorkspaceOnboardingHelpFeature {
    constructor(
        readonly payload: z.infer<typeof RequestWorkspaceOnboardingHelpInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RequestWorkspaceOnboardingHelpFeatureResponse = z.infer<
    typeof RequestWorkspaceOnboardingHelpOutputSchema
>

// GET /platform/onboarding-requests — the console's queue, newest first.
export const ListPlatformOnboardingRequestsInputSchema = z.object({
    status: z.enum(['OPEN', 'DONE', 'CANCELED']).optional(),
})
export const ListPlatformOnboardingRequestsOutputSchema = z.object({
    data: z.array(OnboardingHelpRequestSchema),
})
export class ListPlatformOnboardingRequestsFeature {
    constructor(
        readonly payload: z.infer<typeof ListPlatformOnboardingRequestsInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPlatformOnboardingRequestsFeatureResponse = z.infer<
    typeof ListPlatformOnboardingRequestsOutputSchema
>

// POST /platform/onboarding-requests/:requestId — done, cancelled, or reopened.
export const UpdatePlatformOnboardingRequestInputSchema = z.object({
    status: z.enum(['OPEN', 'DONE', 'CANCELED']),
    resolution: z.string().trim().max(2000).optional(),
})
export const UpdatePlatformOnboardingRequestOutputSchema = OnboardingHelpRequestSchema
export class UpdatePlatformOnboardingRequestFeature {
    constructor(
        readonly requestId: string,
        readonly payload: z.infer<typeof UpdatePlatformOnboardingRequestInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdatePlatformOnboardingRequestFeatureResponse = z.infer<
    typeof UpdatePlatformOnboardingRequestOutputSchema
>
