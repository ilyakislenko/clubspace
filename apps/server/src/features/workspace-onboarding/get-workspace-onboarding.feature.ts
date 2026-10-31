import { z } from 'zod'

// The first-week checklist on the club dashboard, in the order a new club
// does things. Each step is computed from real data, so it ticks itself the
// moment the club does the thing — from the admin, the app or an import.
export const ONBOARDING_STEP_KEYS = [
    'gym',
    'group',
    'schedule',
    'members',
    'video',
] as const

export const GetWorkspaceOnboardingOutputSchema = z.object({
    steps: z.array(
        z.object({
            key: z.enum(ONBOARDING_STEP_KEYS),
            done: z.boolean(),
        }),
    ),
    doneCount: z.number().int(),
    total: z.number().int(),
})

export class GetWorkspaceOnboardingFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetWorkspaceOnboardingFeatureResponse = z.infer<
    typeof GetWorkspaceOnboardingOutputSchema
>
