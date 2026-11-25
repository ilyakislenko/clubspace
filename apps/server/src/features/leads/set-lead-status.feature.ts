import { z } from 'zod'

import { WallClock } from '../personal-trainings/request-personal-training.feature'
import { LEAD_LIMITS, LeadLostReasonSchema, LeadSchema, LeadStatusSchema } from './schemas'

// POST leads/:leadId/status — a move along the pipeline, compare-and-set on
// `from` (a second staff member moving the same lead gets 409).
// TRIAL_BOOKED needs `trialAt` (wall clock in the group's gym zone, else the
// club's); TRIAL_BOOKED → TRIAL_BOOKED reschedules. LOST needs a reason, and
// a comment for OTHER; SPAM erases the personal data at once.
export const SetLeadStatusInputSchema = z.object({
    from: LeadStatusSchema,
    to: LeadStatusSchema,
    trialAt: WallClock.optional(),
    trialGroupId: z.string().uuid().nullable().optional(),
    // Push the group's primary coach «на пробное придёт …» (name and time).
    notifyCoach: z.boolean().optional(),
    lostReason: LeadLostReasonSchema.optional(),
    lostComment: z.string().trim().max(LEAD_LIMITS.lostComment).optional(),
})

export class SetLeadStatusFeature {
    constructor(
        readonly payload: z.infer<typeof SetLeadStatusInputSchema>,
        readonly workspaceId: string,
        readonly leadId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly now: Date = new Date(),
    ) {}
}
export type SetLeadStatusFeatureResponse = z.infer<typeof LeadSchema>
