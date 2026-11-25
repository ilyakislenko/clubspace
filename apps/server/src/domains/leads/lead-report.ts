// «Отчёты → Пробные» (docs/design/2026-11-26-leads.md §3.1): the cohort of
// leads received in a range, how far each got, why the lost ones were lost,
// and how fast the club calls back. Anonymised leads still count (their
// stamps survive); SPAM never does.

import type { PrismaService } from '../../infrastructure/prisma'
import {
    boughtSubscriptionWhere,
    LEAD_LOST_REASONS,
    LEAD_SOURCES,
    type LeadLostReasonValue,
    type LeadSourceValue,
    type LeadStatusValue,
} from './lead-rules'

const HOUR_MS = 60 * 60_000

export type LeadReportRow = {
    source: LeadSourceValue
    status: LeadStatusValue
    createdAt: Date
    contactedAt: Date | null
    trialBookedAt: Date | null
    cameAt: Date | null
    lostReason: LeadLostReasonValue | null
    convertedUserId: string | null
}

export type LeadConversionStats = {
    received: number
    contacted: number
    trialBooked: number
    came: number
    bought: number
    // Non-zero reasons, most frequent first.
    lostByReason: { reason: LeadLostReasonValue; count: number }[]
    // Median hours from receiving to «Связались»; null without such a lead.
    medianContactHours: number | null
}

export type LeadConversion = {
    total: LeadConversionStats
    bySource: (LeadConversionStats & { source: LeadSourceValue })[]
}

export const median = (values: number[]): number | null => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// A stage counts as reached when the lead passed through it, whether or not
// it was stamped on the way (staff may jump forward), and a lost lead keeps
// the stages it reached before.
const stats = (rows: LeadReportRow[], bought: Set<string>): LeadConversionStats => {
    const isBought = (r: LeadReportRow) =>
        r.convertedUserId !== null && bought.has(r.convertedUserId)
    const came = (r: LeadReportRow) =>
        r.cameAt !== null || r.convertedUserId !== null || isBought(r)
    const booked = (r: LeadReportRow) => r.trialBookedAt !== null || came(r)
    const contacted = (r: LeadReportRow) => r.contactedAt !== null || booked(r)
    const lost = new Map<LeadLostReasonValue, number>()
    for (const r of rows) {
        if (r.status === 'LOST' && r.lostReason) {
            lost.set(r.lostReason, (lost.get(r.lostReason) ?? 0) + 1)
        }
    }
    const hours = median(
        rows.flatMap((r) =>
            r.contactedAt ? [(r.contactedAt.getTime() - r.createdAt.getTime()) / HOUR_MS] : [],
        ),
    )
    return {
        received: rows.length,
        contacted: rows.filter(contacted).length,
        trialBooked: rows.filter(booked).length,
        came: rows.filter(came).length,
        bought: rows.filter(isBought).length,
        lostByReason: LEAD_LOST_REASONS.filter((reason) => lost.has(reason))
            .map((reason) => ({ reason, count: lost.get(reason) ?? 0 }))
            .sort((a, b) => b.count - a.count),
        medianContactHours: hours === null ? null : Math.round(hours * 10) / 10,
    }
}

export const summarizeLeadConversion = (
    rows: LeadReportRow[],
    boughtUserIds: Set<string>,
): LeadConversion => {
    const cohort = rows.filter((r) => r.lostReason !== 'SPAM')
    return {
        total: stats(cohort, boughtUserIds),
        bySource: LEAD_SOURCES.map((source) => ({
            source,
            ...stats(
                cohort.filter((r) => r.source === source),
                boughtUserIds,
            ),
        })),
    }
}

export const loadLeadConversion = async (
    prisma: Pick<PrismaService, 'lead' | 'subscription'>,
    p: { workspaceId: string; from?: Date; to?: Date },
): Promise<LeadConversion> => {
    const rows = await prisma.lead.findMany({
        where: {
            workspaceId: p.workspaceId,
            createdAt: { gte: p.from, lte: p.to },
            OR: [{ lostReason: null }, { lostReason: { not: 'SPAM' } }],
        },
        select: {
            source: true,
            status: true,
            createdAt: true,
            contactedAt: true,
            trialBookedAt: true,
            cameAt: true,
            lostReason: true,
            convertedUserId: true,
        },
    })
    const linked = [
        ...new Set(rows.flatMap((r) => (r.convertedUserId ? [r.convertedUserId] : []))),
    ]
    const bought = linked.length
        ? await prisma.subscription.findMany({
              where: {
                  ...boughtSubscriptionWhere(p.workspaceId),
                  userId: { in: linked },
              },
              select: { userId: true },
              distinct: ['userId'],
          })
        : []
    return summarizeLeadConversion(
        rows,
        new Set(bought.flatMap((b) => (b.userId ? [b.userId] : []))),
    )
}
