import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'

export const READINESS_DEFAULT_PER_PAGE = 50
export const READINESS_MAX_PER_PAGE = 200

const RankRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
})

export const ReadinessRuleSchema = z.object({
    minVisits: z.number().int().nullable(),
    minWeeks: z.number().int().nullable(),
})

export const RankReadinessEntrySchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    isOwner: z.boolean(),
    current: z.object({
        levelId: z.string().uuid(),
        levelName: z.string(),
        color: z.string().nullable(),
        stripes: z.number().int(),
        reachedAt: z.iso.datetime(),
    }),
    nextLevel: RankRefSchema,
    rule: ReadinessRuleSchema.nullable(),
    visitsSince: z.number().int(),
    weeksSince: z.number().int(),
    remainingVisits: z.number().int(),
    remainingWeeks: z.number().int(),
    ready: z.boolean(),
    remainingText: z.string().nullable(),
    pendingGrading: z
        .object({ id: z.string().uuid(), date: z.iso.date() })
        .nullable(),
})

export const GetRankReadinessInputSchema = z.object({
    ladderId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    // Only members who have met the rule for their next level.
    readyOnly: strictBoolean().optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(READINESS_MAX_PER_PAGE).optional(),
})
export const GetRankReadinessOutputSchema = z.object({
    ladders: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    ladderId: z.string().uuid().nullable(),
    // One page: the ready first — those not yet on a grading's list ahead of
    // those who are — then the closest to their rule.
    data: z.array(RankReadinessEntrySchema),
    // Entries matching readyOnly, across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // The whole ladder in the caller's scope (and group), whatever the page
    // and readyOnly: everyone measured, the ready, the ready not yet listed.
    summary: z.object({
        all: z.number().int(),
        ready: z.number().int(),
        readyUnlisted: z.number().int(),
    }),
})

export class GetRankReadinessFeature {
    constructor(
        readonly payload: z.infer<typeof GetRankReadinessInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetRankReadinessFeatureResponse = z.infer<
    typeof GetRankReadinessOutputSchema
>
