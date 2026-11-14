import { z } from 'zod'

const TopVideoSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    viewers: z.number().int(),
    completions: z.number().int(),
})

// Club-admin money view (owner, admin). Null for a head coach or a coach — they
// never receive club revenue. Amounts are in the subscription's own integer unit
// (same as elsewhere); `currency` is the dominant currency across the rows the
// figure was summed over, so mixed-currency clubs get one coherent number.
// Each field is one glossary metric (docs/design/2026-11-08-admin-cleanup.md
// B2), computed in domains/metrics.
const RevenueSchema = z.object({
    // `revenue_30d`: paid in the trailing 30 days (abonements + tickets).
    revenue30d: z.number().int(),
    // `mrr`: current paid time-boxed abonements, each normalised to 30 days.
    mrr: z.number().int(),
    // `expected_revenue_30d`: renewals expected within 30 days (hourly snapshot).
    expected30d: z.number().int(),
    currency: z.string().nullable(),
    // `awaiting_payment`: abonements sold but not paid yet (not in the figures
    // above) — the people who owe and the agreed price, dominant currency.
    awaitingPayment: z.object({
        students: z.number().int(),
        amount: z.number().int(),
    }),
    // Revenue per calendar month for the last 6 months (oldest first, current
    // month last); every month present, dominant-currency only.
    trend: z.array(
        z.object({
            month: z.string(), // "YYYY-MM"
            revenue: z.number().int(),
        }),
    ),
    // Sales in the trailing 30 days grouped by tariff, highest revenue first.
    byPlan: z.array(
        z.object({
            planId: z.string().uuid(),
            planName: z.string(),
            count: z.number().int(),
            revenue: z.number().int(),
        }),
    ),
})

// A "so far today" glance (workspace-local calendar day). Revenue is club-admin
// only (null for a head coach or coach), like the revenue card.
const TodaySchema = z.object({
    sessions: z.number().int(), // classes on today's timetable (cancelled excluded)
    checkins: z.number().int(), // `checkins_today`: students' check-ins today
    newStudents: z.number().int(), // `new_students_today`
    revenue: z.number().int().nullable(), // `revenue_today`
    currency: z.string().nullable(),
})

// People counts are over the caller's students (a coach scoped to their own
// groups gets those); each field is one glossary metric (domains/metrics).
export const GetWorkspaceStatsFeatureOutputSchema = z.object({
    today: TodaySchema,
    counts: z.object({
        videos: z.number().int(),
        videosReady: z.number().int(),
        courses: z.number().int(),
        // `students_total`: active student memberships (no owner, no staff).
        students: z.number().int(),
        // `students_active`: attended or opened the app in 30 days — the figure
        // the club pays ClubSpace by.
        activeStudents: z.number().int(),
        // `students_with_abonement`: people holding a current abonement.
        studentsWithAbonement: z.number().int(),
    }),
    activity: z.object({
        // Distinct people who watched a video in the last 7/30 days.
        videoViewers7d: z.number().int(),
        videoViewers30d: z.number().int(),
        completions7d: z.number().int(),
    }),
    attendance: z.object({
        sessions7d: z.number().int(),
        sessions30d: z.number().int(),
        // `checkins_7d` / `checkins_30d`: students' check-ins.
        checkins7d: z.number().int(),
        checkins30d: z.number().int(),
        // `students_attended_7d` / `students_attended_30d`.
        attendedStudents7d: z.number().int(),
        attendedStudents30d: z.number().int(),
        // Students' weekly check-ins for the last 8 weeks (oldest first).
        trend: z.array(
            z.object({
                week: z.string(), // YYYY-MM-DD (window start)
                checkins: z.number().int(),
            }),
        ),
    }),
    retention: z.object({
        // `students_not_attended_30d` (= students − attended in 30 days; the
        // members filter `inactive`).
        notAttended30d: z.number().int(),
        // `renewals_due` (the «Продлить» list total): sport leads only, null
        // for a coach.
        renewalsDue: z.number().int().nullable(),
    }),
    revenue: RevenueSchema.nullable(),
    topVideos7d: z.array(TopVideoSchema),
})

export class GetWorkspaceStatsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetWorkspaceStatsFeatureResponse = z.infer<
    typeof GetWorkspaceStatsFeatureOutputSchema
>
