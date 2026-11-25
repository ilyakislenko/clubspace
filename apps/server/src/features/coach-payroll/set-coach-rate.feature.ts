import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../shared/utils/optimistic-concurrency'
import { MonthSchema, PayrollRateSchema, RATE_AMOUNT_MAX } from './schemas'

const amount = z.number().int().min(0).max(RATE_AMOUNT_MAX)

// Sets the coach's rate from a month on (a second save for the same month
// replaces it). `expectedUpdatedAt` = the coach's `updatedAt` from the list.
export const SetCoachRateInputSchema = z.object({
    effectiveFrom: MonthSchema,
    fixedMonthly: amount,
    perClass: amount,
    // «Платить за занятие, если пришло не меньше N».
    perClassMinStudents: z.number().int().min(0).max(100),
    perStudent: amount,
    // 0..10000 = 0..100 % with two decimals.
    revenueBp: z.number().int().min(0).max(10000),
    ...ExpectedUpdatedAtField,
})

export const CoachRateOutputSchema = PayrollRateSchema.extend({
    id: z.string().uuid(),
    coachId: z.string().uuid(),
    updatedAt: z.iso.datetime(),
})

export class SetCoachRateFeature {
    constructor(
        readonly payload: z.infer<typeof SetCoachRateInputSchema>,
        readonly workspaceId: string,
        readonly coachId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type SetCoachRateFeatureResponse = z.infer<typeof CoachRateOutputSchema>
