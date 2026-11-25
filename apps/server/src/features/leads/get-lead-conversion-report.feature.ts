import { z } from 'zod'

import { LeadLostReasonSchema, LeadSourceSchema } from './schemas'

export const LEAD_REPORT_DEFAULT_DAYS = 30

// GET leads/report — «Отчёты → Пробные»: leads received in the inclusive
// club-local days [from, to] (default: the last 30 days), by source.
export const GetLeadConversionReportQuerySchema = z.object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
})

const LeadConversionStatsSchema = z.object({
    received: z.number().int(),
    // Reached «Связались» or later.
    contacted: z.number().int(),
    trialBooked: z.number().int(),
    came: z.number().int(),
    bought: z.number().int(),
    lostByReason: z.array(
        z.object({ reason: LeadLostReasonSchema, count: z.number().int() }),
    ),
    medianContactHours: z.number().nullable(),
})

export const LeadConversionReportOutputSchema = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    total: LeadConversionStatsSchema,
    bySource: z.array(LeadConversionStatsSchema.extend({ source: LeadSourceSchema })),
})

export class GetLeadConversionReportFeature {
    constructor(
        readonly payload: z.infer<typeof GetLeadConversionReportQuerySchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly now: Date = new Date(),
    ) {}
}
export type GetLeadConversionReportFeatureResponse = z.infer<
    typeof LeadConversionReportOutputSchema
>
