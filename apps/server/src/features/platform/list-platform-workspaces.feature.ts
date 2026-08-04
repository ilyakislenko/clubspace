import { z } from 'zod'

import { PlatformWorkspaceSchema } from './schemas'

export const ListPlatformWorkspacesInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    // Matches against name, key and owner email — the three things a
    // platform admin actually knows about a club they are looking for.
    search: z.string().trim().max(255).optional(),
})

export const ListPlatformWorkspacesOutputSchema = z.object({
    data: z.array(PlatformWorkspaceSchema),
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
