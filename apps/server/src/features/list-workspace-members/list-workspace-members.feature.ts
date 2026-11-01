import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import { MemberGuardianSchema } from '../dependents/schemas'

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
    total: z.number().int(),
    workspaceVideoTotal: z.number().int(),
})

export class ListWorkspaceMembersFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListWorkspaceMembersFeatureResponse = z.infer<
    typeof ListWorkspaceMembersFeatureOutputSchema
>
