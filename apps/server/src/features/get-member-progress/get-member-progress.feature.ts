import { z } from 'zod'

import { AttendanceSessionOutputSchema } from '../attendance/schemas'

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
    gym: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
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

// Attendance is user-scoped (aggregated across all the member's groups) so a
// promotion-decision read doesn't undercount a multi-group student.
const AttendanceSummarySchema = z.object({
    count: z.number().int(),
    recent: z.array(AttendanceSessionOutputSchema),
})

export const GetMemberProgressFeatureOutputSchema = z.object({
    member: MemberSchema,
    summary: SummarySchema,
    groups: z.array(GroupBadgeSchema),
    courses: z.array(CourseProgressSchema),
    recentActivity: z.array(ActivityRowSchema),
    attendance: AttendanceSummarySchema,
})

export class GetMemberProgressFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetMemberProgressFeatureResponse = z.infer<
    typeof GetMemberProgressFeatureOutputSchema
>
