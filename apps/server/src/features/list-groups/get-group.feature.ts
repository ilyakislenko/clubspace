import { z } from 'zod'

import { RISK_REASONS } from '../../domains/retention/risk-signals'
import { GroupMemberSchema, GroupRowSchema } from './schemas'

// A member's current abonement as the group page lists it.
const GroupMemberSubscriptionSchema = z.object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    planName: z.string(),
    // null = waits for the first visit.
    startDate: z.iso.datetime().nullable(),
    endDate: z.iso.datetime().nullable(),
    durationDays: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    classesTotal: z.number().int().nullable(),
    classesRemaining: z.number().int().nullable(),
    isPaid: z.boolean(),
})

// The group page: the list row plus, for whoever runs the group, each
// student's current abonements and «Кому позвонить» signal.
export const GetGroupOutputSchema = GroupRowSchema.extend({
    members: z.array(
        GroupMemberSchema.extend({
            subscriptions: z.array(GroupMemberSubscriptionSchema),
            risk: z
                .object({ reason: z.enum(RISK_REASONS), text: z.string() })
                .nullable(),
        }),
    ),
    // The caller may edit the group (admin scope, its coach, or the manager
    // of its direction). Abonements and risk are shown on the same terms —
    // a coach who only reads every group (coachSeesAllGroups) doesn't see
    // other coaches' students' money and churn, like in «Аналитика».
    canEdit: z.boolean(),
})

export class GetGroupFeature {
    constructor(
        readonly groupId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetGroupFeatureResponse = z.infer<typeof GetGroupOutputSchema>
