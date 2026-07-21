import { z } from 'zod'

export const ListWorkspaceMembersFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            userId: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable().optional(),
            lastname: z.string().nullable().optional(),
            status: z.string(),
            roleName: z.string(),
            isOwner: z.boolean(),
            accessUntil: z.iso.datetime().nullable(),
            // Current abonement at a glance (null = none). classesRemaining/
            // Total are null for a time-only plan.
            subscription: z
                .object({
                    planName: z.string(),
                    classesRemaining: z.number().int().nullable(),
                    classesTotal: z.number().int().nullable(),
                })
                .nullable(),
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
