import { z } from 'zod'

// Emails are validated per-row in the handler (so one bad row doesn't 400 the
// whole batch) — hence a plain string here.
export const ImportMembersInputSchema = z.object({
    members: z
        .array(
            z.object({
                email: z.string(),
                firstname: z.string().max(100).nullable().optional(),
                lastname: z.string().max(100).nullable().optional(),
            }),
        )
        .min(1)
        .max(1000),
})

export const ImportMembersOutputSchema = z.object({
    // Newly added or re-activated members.
    added: z.number().int(),
    // Rows that were already active members of this workspace.
    skipped: z.number().int(),
    // Rows we couldn't import, with a reason.
    invalid: z.array(z.object({ email: z.string(), reason: z.string() })),
})

export class ImportMembersFeature {
    constructor(
        readonly payload: z.infer<typeof ImportMembersInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type ImportMembersFeatureResponse = z.infer<
    typeof ImportMembersOutputSchema
>
