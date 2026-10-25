import { z } from 'zod'

import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'

export const RankGradingResultSchema = z.enum(['PENDING', 'PASSED', 'FAILED'])
export type RankGradingResult = z.infer<typeof RankGradingResultSchema>

export const RankGradingCandidateOutputSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string(),
    fromLevelName: z.string().nullable(),
    fromStripes: z.number().int().nullable(),
    levelId: z.string().uuid(),
    levelName: z.string(),
    levelColor: z.string().nullable(),
    stripes: z.number().int(),
    result: RankGradingResultSchema,
    resultAt: z.iso.datetime().nullable(),
    paid: z.boolean(),
    paidAt: z.iso.datetime().nullable(),
    promotionId: z.string().uuid().nullable(),
})
export type RankGradingCandidateOutput = z.infer<
    typeof RankGradingCandidateOutputSchema
>

export const RankGradingSummaryOutputSchema = z.object({
    id: z.string().uuid(),
    ladderId: z.string().uuid(),
    ladderName: z.string(),
    title: z.string(),
    date: z.iso.date(),
    gym: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    feeAmount: z.number().int().nullable(),
    feeCurrency: z.string().nullable(),
    counts: z.object({
        candidates: z.number().int(),
        pending: z.number().int(),
        passed: z.number().int(),
        failed: z.number().int(),
        paid: z.number().int(),
    }),
    createdAt: z.iso.datetime(),
})
export type RankGradingSummaryOutput = z.infer<
    typeof RankGradingSummaryOutputSchema
>

export const RankGradingDetailOutputSchema =
    RankGradingSummaryOutputSchema.extend({
        candidates: z.array(RankGradingCandidateOutputSchema),
    })
export type RankGradingDetailOutput = z.infer<
    typeof RankGradingDetailOutputSchema
>

export const RankGradingDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

type CandidateCountRow = { result: RankGradingResult; paidAt: Date | null }

type SummaryRow = {
    id: string
    ladderId: string
    ladder: { name: string }
    title: string
    date: Date
    gym: { id: string; name: string } | null
    feeAmount: number | null
    feeCurrency: string | null
    candidates: CandidateCountRow[]
    createdAt: Date
}

export const serializeGradingSummary = (
    g: SummaryRow,
): RankGradingSummaryOutput => ({
    id: g.id,
    ladderId: g.ladderId,
    ladderName: g.ladder.name,
    title: g.title,
    date: dbDateToYmd(g.date),
    gym: g.gym ? { id: g.gym.id, name: g.gym.name } : null,
    feeAmount: g.feeAmount,
    feeCurrency: g.feeCurrency,
    counts: {
        candidates: g.candidates.length,
        pending: g.candidates.filter((c) => c.result === 'PENDING').length,
        passed: g.candidates.filter((c) => c.result === 'PASSED').length,
        failed: g.candidates.filter((c) => c.result === 'FAILED').length,
        paid: g.candidates.filter((c) => c.paidAt !== null).length,
    },
    createdAt: g.createdAt.toISOString(),
})

type CandidateRow = CandidateCountRow & {
    id: string
    userId: string
    user: {
        firstname: string | null
        lastname: string | null
        email: string
    }
    fromLevelName: string | null
    fromStripes: number | null
    levelId: string
    level: { name: string; color: string | null }
    stripes: number
    resultAt: Date | null
    promotionId: string | null
}

export const serializeGradingCandidate = (
    c: CandidateRow,
): RankGradingCandidateOutput => ({
    id: c.id,
    userId: c.userId,
    firstname: c.user.firstname,
    lastname: c.user.lastname,
    email: c.user.email,
    fromLevelName: c.fromLevelName,
    fromStripes: c.fromStripes,
    levelId: c.levelId,
    levelName: c.level.name,
    levelColor: c.level.color,
    stripes: c.stripes,
    result: c.result,
    resultAt: c.resultAt ? c.resultAt.toISOString() : null,
    paid: c.paidAt !== null,
    paidAt: c.paidAt ? c.paidAt.toISOString() : null,
    promotionId: c.promotionId,
})

const candidateSortName = (c: RankGradingCandidateOutput): string =>
    [c.lastname, c.firstname].filter(Boolean).join(' ') || c.email

export const serializeGradingDetail = (
    g: SummaryRow & { candidates: CandidateRow[] },
): RankGradingDetailOutput => ({
    ...serializeGradingSummary(g),
    candidates: g.candidates
        .map(serializeGradingCandidate)
        .sort((a, b) =>
            candidateSortName(a).localeCompare(candidateSortName(b), 'ru'),
        ),
})
