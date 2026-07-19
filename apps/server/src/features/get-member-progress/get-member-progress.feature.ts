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
    // Private staff notes (admin/coach-only view of the member).
    notes: z.string().nullable(),
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

// The member's current abonement (tariff), if any. The access window itself is
// on member.accessUntil; this names which plan is backing it.
const CurrentSubscriptionSchema = z.object({
    id: z.string().uuid(),
    planName: z.string(),
    status: z.string(),
    endDate: z.iso.datetime().nullable(),
})

// Attendance is user-scoped (aggregated across all the member's groups) so a
// promotion-decision read doesn't undercount a multi-group student.
const AttendanceSummarySchema = z.object({
    count: z.number().int(),
    recent: z.array(AttendanceSessionOutputSchema),
})

// Current rank per ladder (a member can hold ranks on several ladders).
const CurrentRankSchema = z.object({
    ladderId: z.string().uuid(),
    ladderName: z.string(),
    levelName: z.string(),
    color: z.string().nullable(),
    stripes: z.number().int(),
})

export const GetMemberProgressFeatureOutputSchema = z.object({
    member: MemberSchema,
    summary: SummarySchema,
    groups: z.array(GroupBadgeSchema),
    courses: z.array(CourseProgressSchema),
    recentActivity: z.array(ActivityRowSchema),
    currentSubscription: CurrentSubscriptionSchema.nullable(),
    attendance: AttendanceSummarySchema,
    currentRanks: z.array(CurrentRankSchema),
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
