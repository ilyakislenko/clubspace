import { isoDayOfWeek, localDateInTz } from '../../features/attendance/attendance-utils'
import { ymdToDbDate } from '../subscriptions/freeze-dates'
import { nextMatchFor } from '../tournaments/schedule'
import { buildDemoClubPlan, type DemoClubPlan, type DemoPlanInput, demoUuid } from './demo-club.plan'
import { buildBerkutDemoPlan } from './berkut-demo.plan'
import { buildDemoOrganizationRows, type DemoOrgClub, type DemoOrgPerson, type DemoOrgTemplateKey, DEMO_ORG_TEMPLATES, demoOrgTemplateId } from './demo-organization'
import { DEMO_OPEN_CONFIRMED, DEMO_OPEN_DECLARED, DEMO_STUDENT_MAT, demoEntryId, demoTournamentId, sexFromName } from './demo-tournaments'
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
                    // «Беркут» is the federation's club (no requests or
                    // promo of its own): only nothing «in the future».
                    expect(futureStamps(buildBerkutDemoPlan(input(now, timezone)), now)).toEqual([])
                }
            }
        })
    }
})

// The federation's tournaments over the clubs as generated (what
// seedDemoOrganization reads back from the database): the script's promises
// hold for the real population on any day — student@ 3rd at the 1st stage
// and next but one on mat 2 at the running cup, Миша 2nd, three entries
// waiting for ACADEMY's coach.
const orgPeople = (plan: DemoClubPlan, club: DemoOrgClub, now: Date, academy: boolean): DemoOrgPerson[] => {
    const users = new Map(plan.users.map((u) => [u.id as string, u]))
    const guardianOf = new Map<string, string>()
    for (const g of plan.guardianships) if (g.consentAt && !guardianOf.has(g.dependentId)) guardianOf.set(g.dependentId, g.guardianId)
    const linked: Record<string, DemoOrgTemplateKey> = academy ? { [demoUuid('ladder:bjj')]: 'adults', [demoUuid('ladder:bjjKids')]: 'kids' } : {}
    const templateOf = (ladderId: string): DemoOrgTemplateKey | null =>
        linked[ladderId] ??
        DEMO_ORG_TEMPLATES.find((t) => demoOrgTemplateId(t.key) === plan.ladders.find((l) => l.id === ladderId)?.templateId)?.key ??
        null
    const promotions = plan.promotions
        .filter((p) => !academy || linked[p.ladderId])
        .sort((a, b) => (b.awardedAt as Date).getTime() - (a.awardedAt as Date).getTime())
    const adultBefore = new Date(now.getTime() - 18 * 365.25 * 86_400_000)
    return plan.members
        .filter((m) => m.role === 'user' && m.data.status === 'ACTIVE' && m.data.userId !== club.ownerId)
        .map((m) => {
            const u = users.get(m.data.userId)!
            const dob = (u.dateOfBirth as Date | null) ?? null
            const isChild = guardianOf.has(u.id as string) || (!!dob && dob > adultBefore)
            const own = promotions.filter((p) => p.userId === u.id && templateOf(p.ladderId))
            const belt = own.find((p) => templateOf(p.ladderId) === (isChild ? 'kids' : 'adults')) ?? own[0]
            const order = belt ? plan.levels.find((l) => l.id === belt.levelId)!.order : 0
            return {
                userId: u.id as string,
                workspaceId: club.id,
                guardianId: guardianOf.get(u.id as string) ?? null,
                isChild,
                competes: own.length > 0,
                tournament:
                    dob || !isChild
                        ? {
                              sex: sexFromName(u.firstname ?? null, u.lastname ?? null),
                              birthYear: dob ? dob.getUTCFullYear() : 1990,
                              level: belt ? { template: templateOf(belt.ladderId)!, order } : null,
                          }
                        : undefined,
            }
        })
}

describe('demo federation tournaments over the generated clubs, reset on any day', () => {
    it('keep the script for 14 days at three hours', () => {
        for (let d = 0; d < 14; d++) {
            for (const h of HOURS) {
                const now = new Date(START.getTime() + d * DAY + h * 3_600_000)
                const a = buildDemoClubPlan(input(now, 'Asia/Tomsk'))
                const b = buildBerkutDemoPlan(input(now, 'Asia/Tomsk'))
                const academy: DemoOrgClub = { id: a.workspaceId, name: 'ACADEMY', ownerId: a.workspace.ownerId as string, ownerEmail: 'owner@academy.demo', coachId: a.accountUserIds.directionManager! }
                const berkut: DemoOrgClub = { id: b.workspaceId, name: 'Беркут', ownerId: b.workspace.ownerId as string, ownerEmail: 'owner@berkut.demo', coachId: b.accountUserIds.coach! }
                const people = [...orgPeople(a, academy, now, true), ...orgPeople(b, berkut, now, false)]
                const studentId = a.accountUserIds.student!
                const decided: Record<string, boolean> = { [studentId]: true, [a.accountUserIds.parent!]: false, [demoUuid('child:misha')]: true, [demoUuid('child:anya')]: false }
                for (const p of people) {
                    if (p.userId in decided) p.consent = decided[p.userId]
                    if (p.tournament && p.userId === studentId) p.tournament.role = 'student'
                    if (p.tournament && p.userId === demoUuid('child:misha')) p.tournament.role = 'misha'
                }
                const rows = buildDemoOrganizationRows({ now, federationUserId: 'u-fed', secretaryUserId: 'u-sec', clubs: { academy, berkut }, people })
                const at = `${now.toISOString()}`
                const entry = (key: 'autumn' | 'cup', userId: string) => rows.entries.find((e) => e.id === demoEntryId(key, userId))
                expect([at, entry('autumn', studentId)?.place]).toEqual([at, 3])
                expect([at, entry('autumn', demoUuid('child:misha'))?.place]).toEqual([at, 2])
                const cup = demoTournamentId('cup')
                const next = nextMatchFor(
                    demoEntryId('cup', studentId),
                    rows.divisions.filter((x) => x.tournamentId === cup).map((x) => ({ id: x.id as string, sortOrder: x.sortOrder, mat: x.mat ?? null, matOrder: x.matOrder ?? null })),
                    rows.matches.filter((m) => m.tournamentId === cup).map((m) => ({ id: m.id as string, divisionId: m.divisionId, round: m.round, position: m.position, entryAId: m.entryAId ?? null, entryBId: m.entryBId ?? null, isBye: !!m.isBye, winnerEntryId: m.winnerEntryId ?? null })),
                )
                expect([at, next?.mat, next?.ahead]).toEqual([at, DEMO_STUDENT_MAT, 1])
                expect([at, rows.matches.filter((m) => m.decidedAt && (m.decidedAt as Date) > now).length]).toEqual([at, 0])
                const open = rows.entries.filter((e) => e.tournamentId === demoTournamentId('open'))
                expect([at, open.filter((e) => e.status === 'DECLARED').length, open.filter((e) => e.status === 'CONFIRMED').length]).toEqual([at, DEMO_OPEN_DECLARED, DEMO_OPEN_CONFIRMED])
                expect([at, rows.entries.filter((e) => e.tournamentId === demoTournamentId('autumn')).length >= 30]).toEqual([at, true])
            }
        }
    })
})
