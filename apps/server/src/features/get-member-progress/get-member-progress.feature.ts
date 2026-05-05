import { z } from 'zod'

const MemberSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable().optional(),
    lastname: z.string().nullable().optional(),
    status: z.string(),
    roleId: z.string().uuid(),
    roleName: z.string(),
    isOwner: z.boolean(),
    accessUntil: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
})

const GroupBadgeSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gym: z.object({ id: z.string().uuid(), name: z.string() }),
    role: z.enum(['coach', 'student']),
})

const SummarySchema = z.object({
    totalVideos: z.number().int(),
    completedCount: z.number().int(),
    inProgressCount: z.number().int(),
    lastWatchedAt: z.iso.datetime().nullable(),
    lastWatchedVideo: z
        .object({ id: z.string().uuid(), title: z.string() })
        .nullable(),
})

const CourseProgressSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    slug: z.string(),
    totalVideos: z.number().int(),
    completedCount: z.number().int(),
    inProgressCount: z.number().int(),
})

const ActivityRowSchema = z.object({
    videoId: z.string().uuid(),
    videoTitle: z.string(),
    status: z.enum(['watched', 'in-progress']),
    position: z.number(),
    completed: z.boolean(),
    watchedAt: z.iso.datetime(),
})

export const GetMemberProgressFeatureOutputSchema = z.object({
    member: MemberSchema,
    summary: SummarySchema,
    groups: z.array(GroupBadgeSchema),
    courses: z.array(CourseProgressSchema),
    recentActivity: z.array(ActivityRowSchema),
})

export class GetMemberProgressFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMemberProgressFeatureResponse = z.infer<
    typeof GetMemberProgressFeatureOutputSchema
>
