import { z } from 'zod'

import type {
    CoachReport,
    CohortReport,
    ForecastReport,
    OccupancyReport,
    OccupancySlot,
} from '../../domains/analytics/analytics-reports'

// Filters every analytics screen takes; ids outside the club are a 404.
export const AnalyticsFilterSchema = z.object({
    gymId: z.string().uuid().optional(),
    directionId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    coachId: z.string().uuid().optional(),
})
export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>

const iso = (d: Date | null): string | null => d?.toISOString() ?? null

// ---- Cohorts ----

const RateSchema = z.number().min(0).max(1).nullable()

export const CohortRetentionSchema = z.object({
    computedAt: z.iso.datetime().nullable(),
    cohorts: z.array(
        z.object({
            month: z.string(),
            size: z.number().int(),
            cells: z.array(
                z.object({
                    offset: z.number().int(),
                    eligible: z.number().int(),
                    retained: z.number().int(),
                    rate: RateSchema,
                    partial: z.boolean(),
                }),
            ),
        }),
    ),
    average: z.array(
        z.object({ offset: z.number().int(), rate: RateSchema, eligible: z.number().int() }),
    ),
})

export const serializeCohortReport = (r: CohortReport) => ({
    computedAt: iso(r.computedAt),
    cohorts: r.cohorts,
    average: r.average,
})

// ---- Occupancy ----

const OccupancySlotSchema = z.object({
    slotId: z.string().uuid(),
    groupId: z.string().uuid(),
    groupName: z.string(),
    gymId: z.string().uuid().nullable(),
    gymName: z.string().nullable(),
    directionId: z.string().uuid().nullable(),
    dayOfWeek: z.number().int(),
    startTime: z.string(),
    scheduled: z.number().int(),
    held: z.number().int(),
    avgAttendance: z.number(),
    capacity: z.number().int(),
    fill: z.number().nullable(),
    booked: z.number().int(),
    missedBookings: z.number().int(),
})

export const ScheduleOccupancySchema = z.object({
    computedAt: z.iso.datetime().nullable(),
    weeks: z.number().int(),
    slots: z.array(OccupancySlotSchema),
    heatmap: z.array(
        z.object({
            gymId: z.string().uuid().nullable(),
            gymName: z.string().nullable(),
            cells: z.array(
                z.object({
                    dayOfWeek: z.number().int(),
                    hour: z.number().int(),
                    slots: z.number().int(),
                    avgAttendance: z.number(),
                    capacity: z.number().int(),
                    fill: z.number().nullable(),
                }),
            ),
        }),
    ),
    weakest: z.array(OccupancySlotSchema),
    strongest: z.array(OccupancySlotSchema),
    suggestions: z.array(
        z.object({
            kind: z.enum(['add_class', 'rethink_slot']),
            slotId: z.string().uuid(),
            text: z.string(),
        }),
    ),
})

const serializeSlot = (s: OccupancySlot) => ({
    slotId: s.slotId,
    groupId: s.groupId,
    groupName: s.groupName,
    gymId: s.gymId,
    gymName: s.gymName,
    directionId: s.directionId,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    scheduled: s.scheduled,
    held: s.held,
    avgAttendance: s.avgAttendance,
    capacity: s.capacity,
    fill: s.fill,
    booked: s.booked,
    missedBookings: s.missedBookings,
})

export const serializeOccupancyReport = (r: OccupancyReport) => ({
    computedAt: iso(r.computedAt),
    weeks: r.weeks,
    slots: r.slots.map(serializeSlot),
    heatmap: r.heatmap,
    weakest: r.weakest.map(serializeSlot),
    strongest: r.strongest.map(serializeSlot),
    suggestions: r.suggestions,
})

// ---- Coaches ----

export const CoachAnalyticsSchema = z.object({
    computedAt: z.iso.datetime().nullable(),
    weeks: z.number().int(),
    coaches: z.array(
        z.object({
            coachId: z.string().uuid(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
            email: z.string().nullable(),
            groupIds: z.array(z.string().uuid()),
            activeStudents: z.number().int(),
            retention: z.object({
                eligible: z.number().int(),
                retained: z.number().int(),
                rate: RateSchema,
            }),
            renewals: z.object({
                due: z.number().int(),
                done: z.number().int(),
                rate: RateSchema,
            }),
            classes: z.number().int(),
            avgAttendance: z.number().nullable(),
        }),
    ),
})

export const serializeCoachReport = (r: CoachReport) => ({
    computedAt: iso(r.computedAt),
    weeks: r.weeks,
    coaches: r.coaches.map((c) => ({
        coachId: c.coachId,
        firstname: c.firstname,
        lastname: c.lastname,
        email: c.email,
        groupIds: c.groupIds,
        activeStudents: c.activeStudents,
        retention: c.retention,
        renewals: c.renewals,
        classes: c.classes,
        avgAttendance: c.avgAttendance,
    })),
})

// ---- Forecast ----

export const RevenueForecastSchema = z.object({
    computedAt: z.iso.datetime().nullable(),
    currency: z.string().nullable(),
    members: z.number().int(),
    monthlyRecurring: z.number().int(),
    horizons: z.array(
        z.object({
            days: z.number().int(),
            potential: z.number().int(),
            expected: z.number().int(),
            atRisk: z.number().int(),
        }),
    ),
    renewal: z.object({
        clubRate: z.number(),
        clubSample: z.number().int(),
        scopeRate: RateSchema,
        scopeSample: z.number().int(),
        usesDefault: z.boolean(),
    }),
    highRiskMoney: z.number().int(),
    trial: z.object({
        trials: z.number().int(),
        converted: z.number().int(),
        rate: RateSchema,
        medianDaysToPay: z.number().int().nullable(),
    }),
})

export const serializeForecastReport = (r: ForecastReport) => ({
    ...r,
    computedAt: iso(r.computedAt),
})
