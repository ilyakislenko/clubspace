import { z } from 'zod'

// The console's own actions. Deliberately an explicit list rather than a
// "workspace." prefix: `workspace.updateSettings` shares that prefix but is
// something a club's own admin does inside their club, and it has no business
// in the platform journal.
export const PLATFORM_AUDIT_ACTIONS = [
    'workspace.create',
    'workspace.update',
    'workspace.transferOwner',
    'workspace.billingUpdate',
    'workspace.billingExpire',
    'workspace.moduleUpdate',
    'workspace.forceFeature',
    'workspace.featureLock',
    'workspace.featureUnlock',
    'workspace.promoApply',
    // Card payments and autopay — the console must see what the club and the
    // renewal job did, not only its own actions.
    'workspace.billingPayment',
    'workspace.billingChargeFailed',
    'workspace.billingRefund',
    'workspace.billingAutopay',
    'workspace.billingCardRemoved',
    'workspace.billingPeriod',
    'workspace.moduleSelfServe',
    'workspace.billingCardCheck',
    'workspace.billingArchive',
    'workspace.onboardingHelpRequest',
    'workspace.onboardingHelpUpdate',
    'workspace.legalAccept',
    // Not a club action, but the platform operator is who must see it.
    'auth.storeReviewSignIn',
    'member.grantStoreReviewAccess',
] as const

export const ListPlatformAuditInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(200).optional(),
})

export const ListPlatformAuditOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid().nullable(),
            // Club name resolved at read time, so a renamed club reads under
            // its current name instead of a bare id.
            workspaceName: z.string().nullable(),
            actorId: z.string().uuid().nullable(),
            actorLabel: z.string().nullable(),
            action: z.string(),
            targetId: z.string().nullable(),
            metadata: z.unknown().nullable(),
            createdAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListPlatformAuditFeature {
    constructor(
        readonly payload: z.infer<typeof ListPlatformAuditInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListPlatformAuditFeatureResponse = z.infer<
    typeof ListPlatformAuditOutputSchema
>
