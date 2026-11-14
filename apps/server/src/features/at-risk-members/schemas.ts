import { z } from 'zod'

import type { CallListEntry } from '../../domains/retention/call-list'
import { displayName } from '../attendance/schemas'
import { MemberGuardianSchema } from '../dependents/schemas'

export const AtRiskReasonSchema = z.enum([
    'lapsed',
    'newcomer',
    'absent',
    'declining',
])

export const AtRiskContactSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    at: z.iso.datetime(),
    byName: z.string(),
    note: z.string().nullable(),
    reason: AtRiskReasonSchema.nullable(),
    signals: z.array(AtRiskReasonSchema),
})

export const AtRiskMemberSchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    guardians: z.array(MemberGuardianSchema),
    groups: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            gymId: z.string().uuid().nullable(),
            gymName: z.string().nullable(),
        }),
    ),
    reason: AtRiskReasonSchema,
    signals: z.array(AtRiskReasonSchema),
    factsText: z.string(),
    facts: z.object({
        lastVisitAt: z.iso.datetime().nullable(),
        daysSinceLastVisit: z.number().int().nullable(),
        firstVisitAt: z.iso.datetime().nullable(),
        visitsLast14d: z.number().int(),
        recentPerWeek: z.number(),
        baselinePerWeek: z.number(),
        lapseKind: z
            .enum(['expired', 'out_of_classes', 'access_ended'])
            .nullable(),
        lapsedAt: z.iso.datetime().nullable(),
        planName: z.string().nullable(),
    }),
    lastContact: AtRiskContactSchema.nullable(),
    // A «Связались» that still covers every current signal (listed only
    // with `snoozed=true`).
    snoozed: z.boolean(),
    // Churn score 0-100 from the hourly snapshot; null before the member's
    // first snapshot.
    score: z.number().int().nullable(),
    level: z.enum(['high', 'medium', 'low']).nullable(),
    // Average monthly spend: what the club loses per month if they leave.
    // Club money: null unless the caller is the owner or an admin.
    monthlySpend: z.number().int().nullable(),
    currency: z.string().nullable(),
})

// Over the caller's scope and the gym / direction / group / coach filters,
// not the reason chip or the page, so every chip keeps its count.
export const AtRiskSummarySchema = z.object({
    total: z.number().int(),
    lapsed: z.number().int(),
    newcomer: z.number().int(),
    absent: z.number().int(),
    declining: z.number().int(),
    high: z.number().int(),
    snoozed: z.number().int(),
    // Null unless the caller is the owner or an admin (club money).
    moneyAtStake: z.number().int().nullable(),
    currency: z.string().nullable(),
})

export const serializeAtRiskMember = (e: CallListEntry, seesMoney: boolean) => ({
    userId: e.userId,
    firstname: e.firstname,
    lastname: e.lastname,
    email: e.email,
    phone: e.phone,
    guardians: e.guardians,
    groups: e.groups.map((g) => ({
        id: g.id,
        name: g.name,
        gymId: g.gymId,
        gymName: g.gymName,
    })),
    reason: e.reason,
    signals: e.signals,
    factsText: e.factsText,
    facts: e.facts,
    lastContact: e.lastContact ? { ...e.lastContact, userId: e.userId } : null,
    snoozed: e.snoozed,
    score: e.score,
    level: e.level,
    monthlySpend: seesMoney ? e.monthlySpend : null,
    currency: e.currency,
})

export const serializeRetentionContact = (c: {
    id: string
    userId: string
    createdAt: Date
    note: string | null
    reason: string | null
    signals: string[]
    contactedBy: {
        firstname: string | null
        lastname: string | null
        email: string | null
    }
}) => ({
    id: c.id,
    userId: c.userId,
    at: c.createdAt.toISOString(),
    byName: displayName(c.contactedBy),
    note: c.note,
    reason: AtRiskReasonSchema.safeParse(c.reason).data ?? null,
    signals: c.signals.flatMap((s) => {
        const parsed = AtRiskReasonSchema.safeParse(s)
        return parsed.success ? [parsed.data] : []
    }),
})
