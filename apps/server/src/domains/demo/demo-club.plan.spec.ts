import { localDateInTz } from '../../features/attendance/attendance-utils'
import { DEMO_ACCOUNTS, DEMO_CLUB_KEY } from './demo-accounts'
import { GROUPS } from './demo-club.catalog'
import { buildDemoClubPlan, demoUuid, type DemoClubPlan } from './demo-club.plan'

const NOW = new Date('2026-11-04T09:30:00.000Z') // Wednesday, 12:30 in Moscow
const TZ = 'Europe/Moscow'
const build = (now: Date = NOW) =>
    buildDemoClubPlan({
        now,
        timezone: TZ,
        personalDataConsentVersion: '2026-11-01',
        legal: { offerVersion: 'offer-1', dpaVersion: 'dpa-1' },
    })

const students = (plan: DemoClubPlan) =>
    plan.members.filter((m) => m.role === 'user' && m.data.status === 'ACTIVE')
const subsOf = (plan: DemoClubPlan, memberId: string) =>
    plan.subscriptions.filter((s) => s.workspaceMemberId === memberId)

describe('buildDemoClubPlan', () => {
    const plan = build()

    it('is deterministic for the same day', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(plan))
    })

    it('builds the club at the demo key with stable ids', () => {
        expect(plan.workspace).toMatchObject({ key: DEMO_CLUB_KEY, isDemo: true, timezone: TZ })
        expect(plan.workspaceId).toBe(demoUuid('workspace'))
        expect(plan.workspaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(plan.gyms).toHaveLength(10)
        expect(plan.directions).toHaveLength(3)
        // БЖЖ and ММА; the head coach writes тайский without a seat.
        expect(plan.directionManagers).toHaveLength(2)
        expect(plan.groups.length).toBeGreaterThanOrEqual(20)
        expect(plan.workspace).toMatchObject({ name: 'ACADEMY', city: 'Томск' })
    })

    it('has about 300 students, ten coaches and the fixed accounts', () => {
        expect(students(plan).length).toBeGreaterThanOrEqual(250)
        expect(students(plan).length).toBeLessThanOrEqual(350)
        expect(plan.members.filter((m) => m.role === 'coach')).toHaveLength(9)
        expect(plan.members.filter((m) => m.role === 'head_coach')).toHaveLength(1)
        expect(plan.members.filter((m) => m.data.status === 'INVITED')).toHaveLength(2)
        for (const a of DEMO_ACCOUNTS) {
            const id = plan.accountUserIds[a.key]
            expect(plan.users.find((u) => u.id === id)?.email).toBe(a.email)
            expect(plan.members.some((m) => m.data.userId === id)).toBe(true)
        }
        expect(new Set(plan.users.map((u) => u.id)).size).toBe(plan.users.length)
        const emails = plan.users.flatMap((u) => (u.email ? [u.email] : []))
        expect(new Set(emails).size).toBe(emails.length)
        expect(plan.users.every((u) => u.isDemo)).toBe(true)
    })

    it('links six children to parents with consent, the rest pending', () => {
        const confirmed = plan.guardianships.filter((g) => g.consentAt)
        expect(confirmed).toHaveLength(6)
        expect(confirmed.filter((g) => g.guardianId === plan.accountUserIds.parent)).toHaveLength(2)
        expect(plan.guardianships.some((g) => !g.consentAt)).toBe(true)
        expect(plan.consents.filter((c) => c.kind === 'DEPENDENT_DATA')).toHaveLength(6)
    })

    it('gives the coach account a class every day of the week', () => {
        const coachId = plan.accountUserIds.coach
        const groups = new Set(
            plan.groupCoaches.filter((c) => c.userId === coachId).map((c) => c.groupId),
        )
        const days = new Set(plan.slots.filter((s) => groups.has(s.groupId)).map((s) => s.dayOfWeek))
        expect([...days].sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it('keeps 14 weeks of history before today and nothing marked today', () => {
        const today = localDateInTz(NOW, TZ)
        const dates = plan.records.map((r) => localDateInTz(r.markedAt as Date, TZ))
        expect(dates.every((d) => d < today)).toBe(true)
        expect(dates.some((d) => d <= '2026-08-01')).toBe(true)
        const pairs = plan.records.map((r) => `${r.sessionId}:${r.userId}`)
        expect(new Set(pairs).size).toBe(pairs.length)
        const keys = plan.sessions.map((s) => s.occurrenceKey)
        expect(new Set(keys).size).toBe(keys.length)
        const sessions = new Set(plan.sessions.map((s) => s.id))
        expect(plan.records.every((r) => sessions.has(r.sessionId))).toBe(true)
        expect(plan.records.length).toBeGreaterThan(2500)
    })

    it('charges packs like the product: never below zero, each visit covered', () => {
        const subs = new Map(plan.subscriptions.map((s) => [s.id, s]))
        for (const s of plan.subscriptions) {
            if (s.classesTotal === null) expect(s.classesRemaining).toBeNull()
            else expect(s.classesRemaining).toBeGreaterThanOrEqual(0)
        }
        for (const r of plan.records) {
            if (!r.usedSubscriptionId) continue
            const s = subs.get(r.usedSubscriptionId)!
            expect((s.startDate as Date) <= (r.markedAt as Date)).toBe(true)
            expect((s.endDate as Date) > new Date((r.markedAt as Date).getTime() - 60 * 60 * 1000)).toBe(true)
        }
    })

    it('has abonements in every state', () => {
        const current = plan.subscriptions.filter(
            (s) => (s.startDate as Date) <= NOW && (s.endDate as Date) > NOW,
        )
        expect(current.some((s) => !s.isPaid)).toBe(true)
        expect(current.some((s) => (s.endDate as Date).getTime() - NOW.getTime() < 7 * 86_400_000)).toBe(true)
        const recentlyEnded = plan.subscriptions.filter(
            (s) =>
                s.endDate !== null &&
                (s.endDate as Date) <= NOW &&
                (s.endDate as Date).getTime() > NOW.getTime() - 30 * 86_400_000,
        )
        expect(recentlyEnded.length).toBeGreaterThan(3)
        expect(plan.liveFreezes).toHaveLength(3)
        const pending = plan.freezeRequests.filter((r) => r.status === 'PENDING')
        expect(pending).toHaveLength(2)
        expect(pending.every((r) => r.pendingSubscriptionId === r.subscriptionId)).toBe(true)
        const twoAbonements = students(plan).filter((m) => {
            const live = subsOf(plan, m.data.id as string).filter(
                (s) => (s.startDate as Date) <= NOW && (s.endDate as Date) > NOW,
            )
            return new Set(live.map((s) => s.planId)).size >= 2
        })
        expect(twoAbonements.length).toBeGreaterThanOrEqual(2)
        expect(plan.subscriptions.some((s) => s.amountPaid === 0)).toBe(true)
        // 30 days from the first training; some bought and not started yet.
        expect(plan.subscriptions.some((s) => s.startsOnFirstVisit && s.startDate === null)).toBe(true)
    })

    it('has six months of sales for the revenue trend', () => {
        const oldest = Math.min(...plan.subscriptions.map((s) => (s.paidAt as Date | null)?.getTime() ?? Infinity))
        expect(NOW.getTime() - oldest).toBeGreaterThan(170 * 86_400_000)
    })

    it('has ranks with history and an upcoming grading with the student', () => {
        expect(plan.ladders).toHaveLength(4)
        const nextGrading = plan.gradings.find((g) => (g.date as Date) > NOW && g.title.includes('синие'))!
        const candidates = plan.gradingCandidates.filter((c) => c.gradingId === nextGrading.id)
        expect(candidates.map((c) => c.userId)).toContain(plan.accountUserIds.student)
        expect(candidates.length).toBeGreaterThanOrEqual(5)
        const past = plan.gradingCandidates.filter((c) => c.result === 'PASSED')
        expect(past.length).toBeGreaterThan(0)
        const promotions = new Set(plan.promotions.map((p) => p.id))
        expect(past.every((c) => promotions.has(c.promotionId as string))).toBe(true)
        expect(plan.promotions.some((p) => p.stripes === 3 && p.userId === plan.accountUserIds.student)).toBe(true)
    })

    it('fills events, announcements, courses, personal trainings and drop-ins', () => {
        expect(plan.events.length).toBeGreaterThanOrEqual(5)
        expect(plan.announcements.some((a) => a.directionId === null)).toBe(true)
        expect(plan.announcements.some((a) => a.directionId !== null)).toBe(true)
        expect(plan.courses.length).toBeGreaterThanOrEqual(5)
        expect(plan.courseAudiences.some((a) => a.kind === 'RANK')).toBe(true)
        expect(plan.videos.every((v) => v.status === 'processing')).toBe(true)
        expect(new Set(plan.ptRequests.map((r) => r.status)).size).toBeGreaterThanOrEqual(3)
        expect(plan.dropIns.length).toBeGreaterThanOrEqual(3)
        expect(plan.achievements.length).toBeGreaterThan(0)
        expect(plan.moduleEntitlements.every((m) => m.mode === 'COMP')).toBe(true)
        expect(plan.billing).toMatchObject({ status: 'ACTIVE', paidTierCode: 'business' })
        expect(plan.legalAcceptance).toMatchObject({ offerVersion: 'offer-1', dpaVersion: 'dpa-1' })
    })

    it('moves every date with today', () => {
        const later = build(new Date(NOW.getTime() + 7 * 86_400_000))
        const max = (p: DemoClubPlan) => Math.max(...p.sessions.map((s) => (s.startAt as Date).getTime()))
        expect(max(later) - max(plan)).toBeGreaterThan(5 * 86_400_000)
        expect(later.workspaceId).toBe(plan.workspaceId)
        expect(GROUPS.length).toBe(later.groups.length)
    })
})
