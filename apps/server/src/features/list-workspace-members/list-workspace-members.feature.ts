import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import { strictBoolean } from '../../shared/utils/strict-boolean'
import { MemberGuardianSchema } from '../dependents/schemas'

export const MEMBERS_DEFAULT_PER_PAGE = 50
export const MEMBERS_MAX_PER_PAGE = 200

export const ListWorkspaceMembersInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce
        .number()
        .int()
        .positive()
        .max(MEMBERS_MAX_PER_PAGE)
        .optional(),
    // Name, e-mail or phone of the member or of a child's guardian; every
    // word must match somewhere ("иван петров").
    q: z.string().trim().min(1).max(200).optional(),
    // Roster segments, same definitions as the screens that count them:
    // renew = «Удержание → Продлить», unpaid = holds an unpaid abonement
    // («Ожидают оплаты»), inactive = a student without a check-in in 30 days.
    access: z.enum(['all', 'renew', 'unpaid', 'inactive']).optional(),
    // Staff and the owner only — for the coach / manager pickers.
    staffOnly: strictBoolean().optional(),
    // Every order ends on the row id, so pages never overlap or skip.
    sort: z.enum(['name', 'expiry', 'newest', 'oldest', 'role']).optional(),
})

export type ListWorkspaceMembersInput = z.infer<
    typeof ListWorkspaceMembersInputSchema
>

export const ListWorkspaceMembersFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            userId: z.string().uuid(),
            email: z.string().nullable(),
            firstname: z.string().nullable().optional(),
            lastname: z.string().nullable().optional(),
            // A child profile without a login of its own; its guardians are
            // the people to contact.
            isDependent: z.boolean(),
            guardians: z.array(MemberGuardianSchema),
            status: z.string(),
            roleName: z.string(),
            isOwner: z.boolean(),
            accessUntil: z.iso.datetime().nullable(),
            // Current abonements at a glance (empty = none), ending soonest
            // first. A member may hold several at once (one per scope).
            // classesRemaining/Total are null for a time-only plan; directions
            // = the abonement's scope (empty = whole club).
            abonements: z.array(
                z.object({
                    planName: z.string(),
                    classesRemaining: z.number().int().nullable(),
                    classesTotal: z.number().int().nullable(),
                    endDate: z.iso.datetime().nullable(),
                    directions: z.array(DirectionRefSchema),
                }),
            ),
            createdAt: z.iso.datetime(),
            // Most recent attendance check-in (null = never attended) — powers
            // the "inactive 30d" churn filter.
            lastCheckInAt: z.iso.datetime().nullable(),
            watchedCount: z.number().int(),
            inProgressCount: z.number().int(),
            lastWatchedAt: z.iso.datetime().nullable(),
            lastWatchedVideo: z
                .object({
                    id: z.string().uuid(),
                    title: z.string(),
                })
                .nullable(),
        }),
    ),
    // Members matching the filters, across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    workspaceVideoTotal: z.number().int(),
})

export class ListWorkspaceMembersFeature {
    constructor(
        readonly payload: ListWorkspaceMembersInput,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListWorkspaceMembersFeatureResponse = z.infer<
    typeof ListWorkspaceMembersFeatureOutputSchema
>
