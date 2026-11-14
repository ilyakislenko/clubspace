import { z } from 'zod'

import { RISK_REASONS } from '../../domains/retention/risk-signals'

export const GROUP_MEMBERS_DEFAULT_PER_PAGE = 50
export const GROUP_MEMBERS_MAX_PER_PAGE = 200

export const ListGroupMembersInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce
        .number()
        .int()
        .positive()
        .max(GROUP_MEMBERS_MAX_PER_PAGE)
        .optional(),
    // Name, e-mail or phone of the student or of a child's guardian; every
    // word must match ("иван петров").
    q: z.string().trim().min(1).max(200).optional(),
})

// A member's current abonement as the group card lists it.
const GroupRosterSubscriptionSchema = z.object({
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

export const ListGroupMembersOutputSchema = z.object({
    // Ordered by last name, first name. Abonements and «Кому позвонить»
    // signal only for whoever runs the group (empty / null otherwise).
    data: z.array(
        z.object({
            userId: z.string().uuid(),
            email: z.string().nullable(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
            joinedAt: z.iso.datetime(),
            subscriptions: z.array(GroupRosterSubscriptionSchema),
            risk: z
                .object({ reason: z.enum(RISK_REASONS), text: z.string() })
                .nullable(),
        }),
    ),
    // Students matching `q`, across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListGroupMembersFeature {
    constructor(
        readonly payload: z.infer<typeof ListGroupMembersInputSchema>,
        readonly groupId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListGroupMembersFeatureResponse = z.infer<
    typeof ListGroupMembersOutputSchema
>
