import { z } from 'zod'

import { WorkspaceBillingSummarySchema } from '../workspace-billing/schemas'
import { PlatformWorkspaceSchema } from './schemas'

export const ListPlatformWorkspacesInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    // Matches against name, key and owner email — the three things a
    // platform admin actually knows about a club they are looking for.
    search: z.string().trim().max(255).optional(),
})

// The list adds each club's platform plan, status and usage, so the console
// can see at a glance who is on trial, overdue or near a limit.
const PlatformWorkspaceListItemSchema = PlatformWorkspaceSchema.extend({
    billing: WorkspaceBillingSummarySchema,
    billingNotes: z.string().nullable(),
})

export const ListPlatformWorkspacesOutputSchema = z.object({
    data: z.array(PlatformWorkspaceListItemSchema),
    meta: z.object({
        curPage: z.number().int(),
        perPage: z.number().int(),
        total: z.number().int(),
    }),
})

// No workspaceId / roleName here: this is a platform-scoped feature, not a
// workspace-scoped one. SuperAdminGuard is what admits the caller, and the
// handler re-checks isSuperAdmin rather than trusting the guard alone.
export class ListPlatformWorkspacesFeature {
    constructor(
        readonly payload: z.infer<typeof ListPlatformWorkspacesInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPlatformWorkspacesFeatureResponse = z.infer<
    typeof ListPlatformWorkspacesOutputSchema
>
