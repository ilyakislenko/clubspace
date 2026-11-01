import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import {
    BillingPromoSchema,
    PlatformTierSchema,
    WorkspaceBillingStatusSchema,
    WorkspaceBillingSummarySchema,
} from '../workspace-billing/schemas'
import { PlatformWorkspaceSchema } from './schemas'

export const PLATFORM_WORKSPACE_SORTS = [
    'createdAt',
    'name',
    'activeMembers',
    'tier',
] as const

export const ListPlatformWorkspacesInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
    // Matches against name, key and owner email — the three things a
    // platform admin actually knows about a club they are looking for.
    search: z.string().trim().max(255).optional(),
    // Billing status (trial / active / overdue / suspended).
    status: WorkspaceBillingStatusSchema.optional(),
    // Tier code the active-member count falls into (start, club, …).
    tier: z.string().trim().max(32).optional(),
    // true = only clubs with a promo running, false = only without.
    promo: strictBoolean().optional(),
    // Default: newest first. tier sorts by tier, then active members.
    sort: z.enum(PLATFORM_WORKSPACE_SORTS).optional(),
    order: z.enum(['asc', 'desc']).optional(),
})

// The list adds each club's billing status, active members, tier and running
// promos, so the console can see at a glance who is on trial, overdue or
// growing.
const PlatformWorkspaceListItemSchema = PlatformWorkspaceSchema.extend({
    billing: WorkspaceBillingSummarySchema,
    billingNotes: z.string().nullable(),
    promos: z.array(BillingPromoSchema),
})

export const ListPlatformWorkspacesOutputSchema = z.object({
    data: z.array(PlatformWorkspaceListItemSchema),
    meta: z.object({
        curPage: z.number().int(),
        perPage: z.number().int(),
        total: z.number().int(),
    }),
    // The configured tiers, for the console's tier filter.
    tiers: z.array(PlatformTierSchema),
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
