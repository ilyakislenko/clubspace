import { z } from 'zod'

import {
    addDays,
    type WorkspaceUsage,
} from '../../domains/billing/platform-plans.config'

// Platform billing shapes shared by the club's own «Тариф и лимиты» page and
// the platform console.

export const WorkspaceBillingStatusSchema = z.enum([
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
])

export const PlatformPlanSchema = z.object({
    planId: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    // Whole currency units, like Plan.price. Display only: collection is manual.
    priceMonthly: z.number().int(),
    currency: z.string(),
    // null = unlimited.
    maxMembers: z.number().int().nullable(),
    maxCoaches: z.number().int().nullable(),
    maxStorageGb: z.number().int().nullable(),
    maxVideos: z.number().int().nullable(),
    features: z.array(z.string()),
})

export const WorkspaceUsageSchema = z.object({
    // ACTIVE members with the `user` role, the owner not counted.
    members: z.number().int(),
    // ACTIVE coaches/head coaches/admins, the owner not counted.
    coaches: z.number().int(),
    storageBytes: z.number().int(),
    videos: z.number().int(),
})

export const WorkspaceBillingSummarySchema = z.object({
    status: WorkspaceBillingStatusSchema,
    plan: PlatformPlanSchema,
    trialEndsAt: z.iso.datetime().nullable(),
    currentPeriodEnd: z.iso.datetime().nullable(),
    pastDueSince: z.iso.datetime().nullable(),
    // When a PAST_DUE club will be suspended (pastDueSince + grace); null
    // otherwise.
    suspendsAt: z.iso.datetime().nullable(),
    usage: WorkspaceUsageSchema,
})

export type PlatformPlanDto = z.infer<typeof PlatformPlanSchema>
export type WorkspaceBillingSummary = z.infer<
    typeof WorkspaceBillingSummarySchema
>

type PlanRow = {
    id: string
    code: string
    name: string
    priceMonthly: number
    currency: string
    maxMembers: number | null
    maxCoaches: number | null
    maxStorageGb: number | null
    maxVideos: number | null
    features: string[]
}

type BillingRow = {
    status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    pastDueSince: Date | null
    plan: PlanRow
}

export const serializePlatformPlan = (plan: PlanRow): PlatformPlanDto => ({
    planId: plan.id,
    code: plan.code,
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    currency: plan.currency,
    maxMembers: plan.maxMembers,
    maxCoaches: plan.maxCoaches,
    maxStorageGb: plan.maxStorageGb,
    maxVideos: plan.maxVideos,
    features: plan.features,
})

export const serializeBillingSummary = (
    billing: BillingRow,
    usage: WorkspaceUsage,
    graceDays: number,
): WorkspaceBillingSummary => ({
    status: billing.status,
    plan: serializePlatformPlan(billing.plan),
    trialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
    pastDueSince: billing.pastDueSince?.toISOString() ?? null,
    suspendsAt:
        billing.status === 'PAST_DUE' && billing.pastDueSince
            ? addDays(billing.pastDueSince, graceDays).toISOString()
            : null,
    usage,
})
