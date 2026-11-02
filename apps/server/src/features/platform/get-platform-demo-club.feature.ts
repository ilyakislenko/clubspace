import { z } from 'zod'

import { DEMO_CLUB_IDS, type DemoClubId } from '../../domains/demo/demo-clubs'

// Which demo club (demo-clubs.ts); ACADEMY when omitted.
export const PlatformDemoClubQuerySchema = z.object({
    club: z.enum(DEMO_CLUB_IDS).default('academy'),
})

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
    club: z.enum(DEMO_CLUB_IDS),
    // The demo club's name as generated.
    name: z.string(),
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
    // The latest «Сбросить демо» of this club (console or CLI); null before the first.
    lastResetAt: z.iso.datetime().nullable(),
    accounts: z.array(PlatformDemoAccountSchema),
})

export class GetPlatformDemoClubFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
        readonly club: DemoClubId,
    ) {}
}

export type GetPlatformDemoClubFeatureResponse = z.infer<
    typeof GetPlatformDemoClubOutputSchema
>
