import { z } from 'zod'

import type {
    ChurnEntry,
    CoachReport,
    CohortReport,
    ForecastReport,
    OccupancyReport,
    OccupancySlot,
} from '../../domains/analytics/analytics-reports'
import { CHURN_REASON_CODES } from '../../domains/analytics/churn-score'
import { MemberGuardianSchema } from '../dependents/schemas'

// Filters every analytics screen takes; ids outside the club are a 404.
export const AnalyticsFilterSchema = z.object({
    gymId: z.string().uuid().optional(),
    directionId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    coachId: z.string().uuid().optional(),
})
export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>

const iso = (d: Date | null): string | null => d?.toISOString() ?? null

// ---- «Кому позвонить сегодня» ----

export const ChurnRiskMemberSchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    guardians: z.array(MemberGuardianSchema),
    groups: z.array(
        z.object({
            id: z.string().uuid(),
            name: z.string(),
            gymId: z.string().uuid().nullable(),
            gymName: z.string().nullable(),
        }),
    ),
    score: z.number().int(),
    level: z.enum(['high', 'medium', 'low']),
    reasons: z.array(
        z.object({
            code: z.enum(CHURN_REASON_CODES),
            points: z.number().int(),
            text: z.string(),
        }),
    ),
    // Average monthly spend: what the club loses per month if they leave.
    monthlySpend: z.number().int(),
    currency: z.string().nullable(),
    lastVisitAt: z.iso.datetime().nullable(),
    lastContact: z
        .object({
            id: z.string().uuid(),
            at: z.iso.datetime(),
            byName: z.string(),
            note: z.string().nullable(),
        })
        .nullable(),
    // A «Связались» younger than 14 days: listed under the contacted ones.
    contactedRecently: z.boolean(),
    canContact: z.boolean(),
})

export const ChurnRiskSummarySchema = z.object({
    total: z.number().int(),
    high: z.number().int(),
    medium: z.number().int(),
    moneyAtStake: z.number().int(),
    currency: z.string().nullable(),
    contactedRecently: z.number().int(),
})

export const serializeChurnRiskMember = (e: ChurnEntry, canContact: boolean) => ({
    userId: e.userId,
    firstname: e.firstname,
    lastname: e.lastname,
    email: e.email,
    phone: e.phone,
    guardians: e.guardians,
    groups: e.groups,
    score: e.score,
    level: e.level,
    reasons: e.reasons,
    monthlySpend: e.monthlySpend,
    currency: e.currency,
    lastVisitAt: iso(e.lastVisitAt),
    lastContact: e.lastContact
        ? {
              id: e.lastContact.id,
              at: e.lastContact.at.toISOString(),
              byName: e.lastContact.byName,
              note: e.lastContact.note,
          }
        : null,
    contactedRecently: e.contactedRecently,
    canContact,
})

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
