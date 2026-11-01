import { z } from 'zod'

import type { AuditService } from '../../domains/audit/services/audit.service'
import type { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import {
    AppFeatureFlagsSchema,
    featureFlagSelect,
    toFeatureFlags,
} from '../../domains/workspace/feature-flags'
import {
    activeFeatureLocks,
    activeFeatureLockWhere,
    FeatureLockSchema,
    serializeFeatureLock,
} from '../../domains/workspace/feature-locks'
import { environment } from '../../environments/environment'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    PlatformTierSchema,
    serializeBillingView,
    serializePlatformTier,
    WorkspaceBillingViewSchema,
} from '../workspace-billing/schemas'
import { PLATFORM_AUDIT_ACTIONS } from './list-platform-audit.feature'
import { PlatformWorkspaceSchema, serializePlatformWorkspace } from './schemas'

// The platform console card of one club: who it is, where its subscription
// stands (active members, tier, modules, the next charge), what the operator
// overrode, the club's own app-section switches, and the console's journal
// for this club. Every console billing endpoint answers with it, so the page
// re-renders from one shape after any action.
export const PlatformWorkspaceBillingOutputSchema = z.object({
    workspace: PlatformWorkspaceSchema,
    billing: WorkspaceBillingViewSchema,
    overrides: z.object({
        customMonthlyPrice: z.number().int().nullable(),
        discountPercent: z.number().int(),
        // The discount ends here; null = no end.
        discountUntil: z.iso.datetime().nullable(),
        freeUntil: z.iso.datetime().nullable(),
        setupFeeWaived: z.boolean(),
        billingPeriodMonths: z.number().int(),
        // «Пробный период с картой» set for this club; null = the
        // PLATFORM_CARD_TRIAL_ENABLED default (billing.trial.cardTrial is the
        // effective value).
        cardTrial: z.boolean().nullable(),
    }),
    // «Стоимость пробного периода»: what the club used during its trial (to
    // now, or the whole trial once it ended) and its cost to ClubSpace at the
    // PLATFORM_COST_* rates, whole rubles.
    trialCost: z.object({
        inTrial: z.boolean(),
        startedAt: z.iso.datetime(),
        endsAt: z.iso.datetime().nullable(),
        days: z.number().int(),
        activeMembers: z.number().int(),
        emailsSent: z.number().int(),
        storageBytes: z.number().int(),
        viewedSeconds: z.number().int(),
        estimatedCost: z.number().int(),
        // When the club paid its first period (the trial converted).
        convertedAt: z.iso.datetime().nullable(),
    }),
    notes: z.string().nullable(),
    // The club's own switches as stored (not narrowed by modules).
    features: AppFeatureFlagsSchema,
    // Switches the platform pinned (in force now); the club cannot change them.
    featureLocks: z.array(FeatureLockSchema),
    tiers: z.array(PlatformTierSchema),
    audit: z.array(
        z.object({
            id: z.string().uuid(),
            action: z.string(),
            actorLabel: z.string().nullable(),
            metadata: z.unknown().nullable(),
            createdAt: z.iso.datetime(),
        }),
    ),
})

export type PlatformWorkspaceBillingView = z.infer<
    typeof PlatformWorkspaceBillingOutputSchema
>

const AUDIT_LIMIT = 50

export const loadPlatformWorkspaceBilling = async (
    deps: {
        prisma: PrismaService
        billing: PlatformBillingService
        audit: AuditService
    },
    workspaceId: string,
): Promise<PlatformWorkspaceBillingView> => {
    const now = new Date()
    const workspace = await deps.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            id: true,
            key: true,
            name: true,
            type: true,
            isActive: true,
            timezone: true,
            ownerId: true,
            createdAt: true,
            _count: { select: { members: true } },
            ...featureFlagSelect,
            featureLocks: {
                where: activeFeatureLockWhere(now),
                select: { feature: true, enabled: true, until: true },
            },
        },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })

    const [owner, state, audit, trialCost] = await Promise.all([
        deps.prisma.user.findUnique({
            where: { id: workspace.ownerId },
            select: { id: true, email: true, firstname: true, lastname: true },
        }),
        deps.billing.getState(workspaceId),
        deps.audit.list({
            workspaceId,
            actions: [...PLATFORM_AUDIT_ACTIONS],
            perPage: AUDIT_LIMIT,
        }),
        deps.billing.estimateTrialCost(workspaceId, now),
    ])
    const { pricing, graceDays } = environment.billing
    const row = state.row
    return {
        workspace: serializePlatformWorkspace(workspace, owner),
        billing: serializeBillingView(state, graceDays, pricing.setupFee),
        overrides: {
            customMonthlyPrice: row.customMonthlyPrice,
            discountPercent: row.discountPercent,
            discountUntil: row.discountUntil?.toISOString() ?? null,
            freeUntil: row.freeUntil?.toISOString() ?? null,
            setupFeeWaived: row.setupFeeWaived,
            billingPeriodMonths: row.billingPeriodMonths,
            cardTrial: row.cardTrial ?? null,
        },
        trialCost: {
            inTrial: trialCost.inTrial,
            startedAt: trialCost.startedAt.toISOString(),
            endsAt: trialCost.endsAt?.toISOString() ?? null,
            days: trialCost.days,
            activeMembers: trialCost.activeMembers,
            emailsSent: trialCost.emailsSent,
            storageBytes: trialCost.storageBytes,
            viewedSeconds: trialCost.viewedSeconds,
            estimatedCost: trialCost.estimatedCost,
            convertedAt: row.convertedAt?.toISOString() ?? null,
        },
        notes: row.notes,
        features: toFeatureFlags(workspace),
        featureLocks: activeFeatureLocks(workspace.featureLocks, now).map(
            serializeFeatureLock,
        ),
        tiers: pricing.tiers.map(serializePlatformTier),
        audit: audit.data.map((e) => ({
            id: e.id,
            action: e.action,
            actorLabel: e.actorLabel,
            metadata: e.metadata,
            createdAt: e.createdAt,
        })),
    }
}
