import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import { AnalyticsFilterSchema } from '../club-analytics/schemas'
import { AtRiskMemberSchema, AtRiskReasonSchema, AtRiskSummarySchema } from './schemas'

export const AT_RISK_DEFAULT_PER_PAGE = 50
export const AT_RISK_MAX_PER_PAGE = 200

// «Кому позвонить». Gym / direction / group / coach narrow the caller's scope
// (an id from another club is a 404); `reason` is the chip; `snoozed=true`
// lists the ones already contacted instead of the ones to call.
export const ListAtRiskMembersInputSchema = AnalyticsFilterSchema.extend({
    reason: AtRiskReasonSchema.optional(),
    snoozed: strictBoolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    perPage: z.coerce.number().int().min(1).max(AT_RISK_MAX_PER_PAGE).optional(),
})

export const ListAtRiskMembersOutputSchema = z.object({
    data: z.array(AtRiskMemberSchema),
    summary: AtRiskSummarySchema,
    // Rows matching every filter (chip and snoozed included), across pages.
    total: z.number().int(),
    page: z.number().int(),
    perPage: z.number().int(),
    // When the churn scores were computed (null = not yet).
    scoredAt: z.iso.datetime().nullable(),
})

export class ListAtRiskMembersFeature {
    constructor(
        readonly payload: z.infer<typeof ListAtRiskMembersInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAtRiskMembersFeatureResponse = z.infer<
    typeof ListAtRiskMembersOutputSchema
>
