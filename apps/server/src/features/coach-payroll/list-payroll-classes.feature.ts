import { z } from 'zod'

import { MonthSchema } from './schemas'

export const ListPayrollClassesInputSchema = z.object({ month: MonthSchema })

export const PayrollClassItemSchema = z.object({
    sessionId: z.string().uuid(),
    // Slot-local calendar day.
    date: z.iso.date(),
    startAt: z.iso.datetime(),
    groupId: z.string().uuid(),
    groupName: z.string(),
    // Marks except the coach's own; guests count.
    marks: z.number().int(),
    // paid / unpaid (fewer marks than the threshold) — credited to this coach;
    // cancelled — cancelled after the roster was opened, never pays;
    // other_coach — a class of this coach's group run by someone else.
    status: z.enum(['paid', 'unpaid', 'cancelled', 'other_coach']),
    // Credited to this coach, who is not a coach of the group («замена»).
    substitute: z.boolean(),
    // Who ran an other_coach class (coachId null = the account is gone).
    ranBy: z.object({ coachId: z.string().uuid().nullable(), name: z.string() }).nullable(),
})

// One coach's classes of the month, live (also for a closed month).
export const ListPayrollClassesOutputSchema = z.object({
    month: z.string(),
    coachId: z.string().uuid(),
    items: z.array(PayrollClassItemSchema),
})

export class ListPayrollClassesFeature {
    constructor(
        readonly payload: z.infer<typeof ListPayrollClassesInputSchema>,
        readonly workspaceId: string,
        readonly coachId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPayrollClassesFeatureResponse = z.infer<typeof ListPayrollClassesOutputSchema>
