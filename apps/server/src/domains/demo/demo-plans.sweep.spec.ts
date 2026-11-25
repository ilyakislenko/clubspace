import { isoDayOfWeek, localDateInTz } from '../../features/attendance/attendance-utils'
import { ymdToDbDate } from '../subscriptions/freeze-dates'
import { buildDemoClubPlan, type DemoClubPlan, type DemoPlanInput } from './demo-club.plan'
import { buildRitmDemoPlan } from './ritm-demo.plan'

// Whatever day and hour the demo is reset, both clubs read the same: classes
// today, a request of every kind waiting, ПРОДЛИ5 in use, and nothing
// generated «in the future» (a sale, a payment, a cancellation, a mark).
const START = new Date('2026-11-23T00:00:00.000Z') // a Monday
const DAY = 86_400_000
// UTC hours: 22:00 / 01:00 are early-morning resets in both zones (before the
// day's first sales and classes) and 10:00 is mid-afternoon in Tomsk.
const HOURS = [22, 1, 10]
const ZONES = ['Asia/Tomsk', 'Europe/Moscow']

const input = (now: Date, timezone: string): DemoPlanInput => ({
    now,
    timezone,
    personalDataConsentVersion: '2026-11-01',
    legal: { offerVersion: 'o', dpaVersion: 'd' },
    pseudonymSecret: 's',
    storageBucket: 'b',
})

// Timestamps that record something already done: never after the reset.
const PAST_FIELDS = ['createdAt', 'paidAt', 'cancelledAt', 'markedAt', 'decidedAt', 'refundedAt', 'promotedAt', 'contactedAt'] as const

const futureStamps = (plan: DemoClubPlan, now: Date): string[] =>
    Object.entries(plan).flatMap(([table, rows]) =>
        (Array.isArray(rows) ? rows : [rows]).flatMap((row) => {
            if (!row || typeof row !== 'object') return []
            const data = 'data' in row && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : (row as Record<string, unknown>)
            return PAST_FIELDS.flatMap((field) => {
                const value = data[field]
                return value instanceof Date && value.getTime() > now.getTime()
                    ? [`${table}.${field} ${String(data.id ?? data.title ?? '')} ${value.toISOString()} > ${now.toISOString()}`]
                    : []
            })
        }),
    )

const check = (plan: DemoClubPlan, now: Date, timezone: string, academy: boolean) => {
    const today = localDateInTz(now, timezone)
    const dow = isoDayOfWeek(ymdToDbDate(today))
    expect(plan.slots.some((s) => s.dayOfWeek === dow)).toBe(true)
    expect(plan.members.some((m) => m.data.status === 'INVITED')).toBe(true)
    expect(plan.freezeRequests.some((r) => r.status === 'PENDING')).toBe(true)
    const openPt = plan.ptRequests.filter(
        (r) =>
            r.status === 'PENDING_COACH' &&
            plan.ptOptions.some((o) => o.requestId === r.id && o.proposedBy === 'member' && (o.startAt as Date) > now),
    )
    expect(openPt.length).toBeGreaterThan(0)
    expect(plan.videoReviews.some((r) => r.status === 'open')).toBe(true)
    if (academy) {
        const code = plan.discounts.find((d) => d.code === 'ПРОДЛИ5')!
        expect(plan.subscriptions.filter((s) => s.discountId === code.id).length).toBeGreaterThan(0)
    }
    expect(futureStamps(plan, now)).toEqual([])
}

describe('demo clubs, reset on any day at any hour', () => {
    for (const timezone of ZONES) {
        it(`hold up for 14 days in ${timezone}`, () => {
            for (let d = 0; d < 14; d++) {
                for (const h of HOURS) {
                    const now = new Date(START.getTime() + d * DAY + h * 3_600_000)
                    check(buildDemoClubPlan(input(now, timezone)), now, timezone, true)
                    check(buildRitmDemoPlan(input(now, timezone)), now, timezone, false)
                }
            }
        })
    }
})
