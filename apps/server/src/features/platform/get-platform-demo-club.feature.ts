import { z } from 'zod'

export const PlatformDemoAccountSchema = z.object({
    // null for a child: opened from the parent's «Я / ребёнок» switcher.
    email: z.string().nullable(),
    name: z.string(),
    roleLabel: z.string(),
    summary: z.string(),
    // The account a child is reached through.
    via: z.string().nullable(),
})

export const GetPlatformDemoClubOutputSchema = z.object({
    // DEMO_MODE on and valid: fixed-code sign-in and the reset work.
    enabled: z.boolean(),
    workspaceKey: z.string(),
    // The fixed code for the demo accounts; only while demo mode is on.
    loginCode: z.string().nullable(),
    workspace: z
        .object({
            id: z.uuid(),
            name: z.string(),
            joinCode: z.string().nullable(),
        })
        .nullable(),
    // The latest «Сбросить демо» (console or CLI); null before the first.
    lastResetAt: z.iso.datetime().nullable(),
    accounts: z.array(PlatformDemoAccountSchema),
})

export class GetPlatformDemoClubFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPlatformDemoClubFeatureResponse = z.infer<
    typeof GetPlatformDemoClubOutputSchema
>
