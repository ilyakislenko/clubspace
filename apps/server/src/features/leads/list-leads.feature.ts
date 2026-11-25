import { z } from 'zod'

import { LeadSchema, LeadSourceSchema } from './schemas'

export const LEADS_DEFAULT_PER_PAGE = 50
export const LEADS_MAX_PER_PAGE = 100

export const LEAD_VIEWS = [
    'needsAction',
    'new',
    'contacted',
    'trialBooked',
    'came',
    'bought',
    'lost',
    'all',
] as const
export type LeadView = (typeof LEAD_VIEWS)[number]

// GET leads — «Ученики → Пробные». `view` defaults to needsAction; `q`
// matches the name or the phone's digits.
export const ListLeadsQuerySchema = z.object({
    view: z.enum(LEAD_VIEWS).optional(),
    source: LeadSourceSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(LEADS_MAX_PER_PAGE).optional(),
})

export const LeadCountsSchema = z.object({
    // = new + trialOverdue: the «Сегодня» row and the tab badge.
    needsAction: z.number().int(),
    new: z.number().int(),
    // Booked trials whose time has passed without a mark.
    trialOverdue: z.number().int(),
    contacted: z.number().int(),
    trialBooked: z.number().int(),
    came: z.number().int(),
    bought: z.number().int(),
    lost: z.number().int(),
})

export const ListLeadsOutputSchema = z.object({
    data: z.array(LeadSchema),
    total: z.number().int(),
    // Counts per view, ignoring `source` and `q`.
    counts: LeadCountsSchema,
    // The public form takes requests (switch on, operator set).
    formEnabled: z.boolean(),
    timezone: z.string(),
})

export class ListLeadsFeature {
    constructor(
        readonly payload: z.infer<typeof ListLeadsQuerySchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly now: Date = new Date(),
    ) {}
}
export type ListLeadsFeatureResponse = z.infer<typeof ListLeadsOutputSchema>
