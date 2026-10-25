import { z } from 'zod'

import type { WorkspaceRiskEntry } from '../../domains/retention/load-workspace-risk'
import { displayName } from '../attendance/schemas'

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
    email: z.string(),
    phone: z.string().nullable(),
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
    snoozed: z.boolean(),
    canContact: z.boolean(),
})

export const AtRiskSummarySchema = z.object({
    total: z.number().int(),
    lapsed: z.number().int(),
    newcomer: z.number().int(),
    absent: z.number().int(),
    declining: z.number().int(),
    snoozed: z.number().int(),
})

export const serializeAtRiskMember = (
    e: WorkspaceRiskEntry & { canContact: boolean },
) => ({
    userId: e.userId,
    firstname: e.firstname,
    lastname: e.lastname,
    email: e.email,
    phone: e.phone,
    groups: e.groups,
    reason: e.risk.reason,
    signals: e.risk.signals,
    factsText: e.factsText,
    facts: {
        lastVisitAt: e.risk.facts.lastVisitAt?.toISOString() ?? null,
        daysSinceLastVisit: e.risk.facts.daysSinceLastVisit,
        firstVisitAt: e.risk.facts.firstVisitAt?.toISOString() ?? null,
        visitsLast14d: e.risk.facts.visitsLast14d,
        recentPerWeek: e.risk.facts.recentPerWeek,
        baselinePerWeek: e.risk.facts.baselinePerWeek,
        lapseKind: e.risk.facts.lapseKind,
        lapsedAt: e.risk.facts.lapsedAt?.toISOString() ?? null,
        planName: e.risk.facts.planName,
    },
    lastContact: e.lastContact
        ? {
              id: e.lastContact.id,
              userId: e.userId,
              at: e.lastContact.at.toISOString(),
              byName: e.lastContact.byName,
              note: e.lastContact.note,
              reason: e.lastContact.reason,
              signals: e.lastContact.signals,
          }
        : null,
    snoozed: e.snoozed,
    canContact: e.canContact,
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
        email: string
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
