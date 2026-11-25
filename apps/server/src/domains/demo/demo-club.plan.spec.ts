import { localDateInTz } from '../../features/attendance/attendance-utils'
import { DEMO_ACCOUNTS, DEMO_CLUB_KEY } from './demo-accounts'
import { GROUPS } from './demo-club.catalog'
import { revenueTrend } from '../metrics/revenue'
import { countedClasses } from '../payroll/payroll-rules'
import { type ForecastSubscription, renewalHistory } from '../analytics/forecast'
import { buildDemoClubPlan, demoUuid, type DemoClubPlan } from './demo-club.plan'
import { AI_CHAT_DATA_WARNING } from '../ai-assistant/ai-chat-warning'
import { pseudonymFor } from '../ai-assistant/pseudonym'
import {
    deriveTurns,
    extractEntityTokens,
    parseStoredMessages,
    parseStoredRefs,
} from '../../features/ai-chat/ai-chat-utils'
import { isBirthdayOn } from '../birthdays/birthdays'

const NOW = new Date('2026-11-04T09:30:00.000Z') // Wednesday, 12:30 in Moscow
const TZ = 'Europe/Moscow'
const build = (now: Date = NOW) =>
    buildDemoClubPlan({
        now,
        timezone: TZ,
        personalDataConsentVersion: '2026-11-01',
        legal: { offerVersion: 'offer-1', dpaVersion: 'dpa-1' },
        pseudonymSecret: 'demo-secret',
        storageBucket: 'clubspace',
    })

const students = (plan: DemoClubPlan) =>
    plan.members.filter((m) => m.role === 'user' && m.data.status === 'ACTIVE')
const subsOf = (plan: DemoClubPlan, memberId: string) =>
    plan.subscriptions.filter((s) => s.workspaceMemberId === memberId)
// Active students whose birthday is `ymd` (the «Дни рождения сегодня» rule).
const birthdaysToday = (plan: DemoClubPlan, ymd: string) => {
    const dob = new Map(plan.users.map((u) => [u.id, (u.dateOfBirth as Date | null) ?? null]))
    return students(plan)
        .map((m) => m.data.userId as string)
        .filter((id) => {
            const d = dob.get(id)
            return !!d && isBirthdayOn(d, ymd)
        })
}

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

    it('keeps a year of history before today and nothing marked today', () => {
        const today = localDateInTz(NOW, TZ)
        const dates = plan.records.map((r) => localDateInTz(r.markedAt as Date, TZ))
        expect(dates.every((d) => d < today)).toBe(true)
        expect(dates.some((d) => d <= '2025-11-04')).toBe(true)
        const pairs = plan.records.map((r) => `${r.sessionId}:${r.userId}`)
        expect(new Set(pairs).size).toBe(pairs.length)
        const keys = plan.sessions.map((s) => s.occurrenceKey)
        expect(new Set(keys).size).toBe(keys.length)
        const sessions = new Set(plan.sessions.map((s) => s.id))
        expect(plan.records.every((r) => sessions.has(r.sessionId))).toBe(true)
        expect(plan.records.length).toBeGreaterThan(20_000)
    })

    it('keeps the visits of those who left the club, without a membership', () => {
        const memberIds = new Set(plan.members.map((m) => m.data.userId))
        const left = new Set(plan.records.map((r) => r.userId).filter((id) => !memberIds.has(id)))
        expect(left.size).toBeGreaterThan(100)
        expect(plan.users.filter((u) => left.has(u.id as string))).toHaveLength(left.size)
        expect(plan.groupMembers.some((g) => left.has(g.userId))).toBe(false)
        // Their last visit is at least six weeks old.
        const sixWeeks = localDateInTz(new Date(NOW.getTime() - 42 * 86_400_000), TZ)
        expect(
            plan.records
                .filter((r) => left.has(r.userId))
                .every((r) => localDateInTz(r.markedAt as Date, TZ) <= sixWeeks),
        ).toBe(true)
    })

    it('keeps the abonements of those who left, without a member, and every sale names its buyer', () => {
        const memberIds = new Set(plan.members.map((m) => m.data.userId))
        const kept = plan.subscriptions.filter((s) => s.workspaceMemberId === null)
        expect(new Set(kept.map((s) => s.userId)).size).toBeGreaterThan(100)
        expect(kept.every((s) => s.userId && !memberIds.has(s.userId))).toBe(true)
        expect(plan.subscriptions.every((s) => typeof s.userId === 'string')).toBe(true)
    })

    it('renews like a healthy club once those who left count: about 80%', () => {
        const trial = new Set(plan.plans.filter((p) => p.isFreeTrial).map((p) => p.id))
        const byPerson = new Map<string, ForecastSubscription[]>()
        for (const s of plan.subscriptions) {
            const list = byPerson.get(s.userId as string) ?? []
            list.push({
                id: s.id as string,
                status: s.status as string,
                startDate: (s.startDate as Date | null) ?? null,
                endDate: (s.endDate as Date | null) ?? null,
                createdAt: s.createdAt as Date,
                durationDays: s.durationDays ?? null,
                amountPaid: s.amountPaid,
                isTrial: trial.has(s.planId),
                directionIds: [],
            })
            byPerson.set(s.userId as string, list)
        }
        let due = 0
        let done = 0
        for (const subs of byPerson.values()) {
            const r = renewalHistory(NOW, subs)
            due += r.due
            done += r.done
        }
        expect(due).toBeGreaterThan(1000)
        expect(done / due).toBeGreaterThan(0.75)
        expect(done / due).toBeLessThan(0.85)
    })

    it('gives «Загрузка расписания» weak slots and one over its roster', () => {
        const from = localDateInTz(new Date(NOW.getTime() - 56 * 86_400_000), TZ)
        const roster = new Map<string, number>()
        for (const g of plan.groupMembers) roster.set(g.groupId, (roster.get(g.groupId) ?? 0) + 1)
        const marks = new Map<string, number>()
        for (const r of plan.records) marks.set(r.sessionId, (marks.get(r.sessionId) ?? 0) + 1)
        const bySlot = new Map<string, { groupId: string; marks: number; held: number }>()
        for (const s of plan.sessions) {
            if (!s.slotId || localDateInTz(s.startAt as Date, TZ) < from) continue
            const slot = bySlot.get(s.slotId) ?? { groupId: s.groupId as string, marks: 0, held: 0 }
            slot.marks += marks.get(s.id as string) ?? 0
            slot.held += 1
            bySlot.set(s.slotId, slot)
        }
        const fills = [...bySlot.values()].map((s) => s.marks / s.held / roster.get(s.groupId)!)
        expect(fills.filter((f) => f < 0.4).length).toBeGreaterThanOrEqual(2)
        expect(fills.some((f) => f >= 0.9)).toBe(true)
    })

    it('has trials that converted and trials that did not', () => {
        const trial = plan.plans.find((p) => p.isFreeTrial)!
        const trials = plan.subscriptions.filter((s) => s.planId === trial.id)
        const converted = trials.filter((t) =>
            plan.subscriptions.some(
                (s) =>
                    s.workspaceMemberId === t.workspaceMemberId &&
                    s.planId !== trial.id &&
                    (s.createdAt as Date) >= (t.createdAt as Date),
            ),
        )
        expect(converted.length).toBeGreaterThan(5)
        expect(trials.length - converted.length).toBeGreaterThanOrEqual(3)
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

    it('has six months of sales for the revenue trend, no month out of line', () => {
        const oldest = Math.min(...plan.subscriptions.map((s) => (s.paidAt as Date | null)?.getTime() ?? Infinity))
        expect(NOW.getTime() - oldest).toBeGreaterThan(170 * 86_400_000)
        const paid = plan.subscriptions
            .filter((s) => s.isPaid)
            .map((s) => ({
                amountPaid: s.amountPaid as number,
                currency: s.currency as string,
                paidAt: s.paidAt as Date,
                createdAt: s.createdAt as Date,
            }))
        const trend = revenueTrend(paid, NOW, 'RUB', TZ)
        expect(trend.every((m) => m.revenue > 0)).toBe(true)
        // Renewals bought ahead in the last weeks don't pile up in one month.
        const full = trend.slice(0, 5).map((m) => m.revenue)
        expect(Math.max(...full) / Math.min(...full)).toBeLessThan(1.3)
    })

    it('has most renewals bought ahead, so few accesses run out soon', () => {
        const active = students(plan)
        const soon = NOW.getTime() + 14 * 86_400_000
        const pendingMembers = new Set(
            plan.subscriptions.filter((s) => s.status === 'ACTIVE' && s.startDate === null).map((s) => s.workspaceMemberId),
        )
        const expiring = active.filter((m) => {
            const until = (m.data.accessUntil as Date | null)?.getTime()
            return until !== undefined && until >= NOW.getTime() && until < soon && !pendingMembers.has(m.data.id as string)
        })
        expect(expiring.length / active.length).toBeGreaterThan(0.05)
        expect(expiring.length / active.length).toBeLessThan(0.22)
        const unpaid = plan.subscriptions.filter((s) => !s.isPaid)
        expect(unpaid.length).toBeGreaterThanOrEqual(3)
        expect(unpaid.length).toBeLessThanOrEqual(5)
    })

    it('records how every paid sale was paid: card, transfer or cash at the reception', () => {
        const paid = plan.subscriptions.filter((s) => s.isPaid && (s.amountPaid ?? 0) > 0)
        const share = (m: string) => paid.filter((s) => s.paymentMethod === m).length / paid.length
        expect(share('CARD') + share('TRANSFER') + share('CASH')).toBe(1)
        expect(share('CARD')).toBeGreaterThan(0.35)
        expect(share('CASH')).toBeGreaterThan(0.1)
        expect(plan.subscriptions.filter((s) => !s.isPaid || s.amountPaid === 0).every((s) => s.paymentMethod === null)).toBe(true)
    })

    it('has one partial cash refund of a recent abonement, in the last 30 days', () => {
        const check = (p: DemoClubPlan, now: Date) => {
            expect(p.refunds).toHaveLength(1)
            const [refund] = p.refunds
            const sale = p.subscriptions.find((s) => s.id === refund.subscriptionId)!
            expect(refund).toMatchObject({ method: 'CASH', currency: 'RUB', userId: sale.userId, workspaceId: p.workspaceId })
            expect(refund.eventRegistrationId ?? null).toBeNull()
            expect(refund.paymentId ?? null).toBeNull()
            // The sale stays as it was: paid in cash, its amount; only the refunded sum rises.
            expect(sale).toMatchObject({ isPaid: true, paymentMethod: 'CASH' })
            expect(refund.amount).toBeGreaterThan(0)
            expect(refund.amount).toBeLessThan(sale.amountPaid as number)
            // Every sale's refundedAmount is the sum of its refunds.
            for (const s of p.subscriptions) {
                const refunded = p.refunds.filter((r) => r.subscriptionId === s.id).reduce((sum, r) => sum + r.amount, 0)
                expect(s.refundedAmount ?? 0).toBe(refunded)
            }
            const at = (refund.refundedAt as Date).getTime()
            expect(at).toBeGreaterThanOrEqual((sale.paidAt as Date).getTime())
            expect(at).toBeLessThanOrEqual(now.getTime())
            expect(now.getTime() - at).toBeLessThan(30 * 86_400_000)
            // Made at the reception by the administrator, and audited like a live one.
            expect(refund.createdById).toBe(p.accountUserIds.admin)
            expect(p.auditEvents.some((e) => e.action === 'payment.refund' && e.targetId === sale.userId)).toBe(true)
        }
        check(plan, NOW)
        // Whatever day the demo is reset on.
        for (const days of [9, 17, 26]) {
            const now = new Date(NOW.getTime() + days * 86_400_000)
            check(build(now), now)
        }
    })

    it('has the three demo discounts, a few sales priced with them and two staff one-offs', () => {
        const check = (p: DemoClubPlan) => {
            expect(p.discounts.map((d) => [d.name, d.code ?? null, d.isFamily ?? false, d.value])).toEqual([
                ['Семейная', null, true, 10],
                ['Студенческая', null, false, 15],
                ['Продление −5%', 'ПРОДЛИ5', false, 5],
            ])
            expect(p.discounts.find((d) => d.code)?.oncePerMember).toBe(true)
            // Every sale records the tariff price it was sold against, and who priced it.
            const price = new Map(p.plans.map((t) => [t.id as string, t.price as number]))
            expect(p.subscriptions.every((s) => s.listPrice === price.get(s.planId as string) && !!s.pricedById)).toBe(true)
            const named = (name: string) => p.subscriptions.filter((s) => s.discountName === name)
            // «Семейная»: only Елена's children, priced by §1 (half-up percent).
            const kids = new Set(
                p.guardianships.filter((g) => g.guardianId === p.accountUserIds.parent).map((g) => g.dependentId),
            )
            expect(named('Семейная').length).toBeGreaterThan(0)
            expect(named('Семейная').every((s) => kids.has(s.userId as string))).toBe(true)
            // Each one is a sale listSaleDiscounts would have offered it on: at
            // the sale, another of the family (Елена or the sibling) held an
            // abonement matching currentSubscriptionWhere — a member's, ACTIVE,
            // not past its end.
            const family = new Set([...kids, p.accountUserIds.parent])
            const currentAt = (t: Date) => (x: (typeof p.subscriptions)[number]) =>
                x.workspaceMemberId != null &&
                x.status === 'ACTIVE' &&
                (x.endDate == null || (x.endDate as Date) > t) &&
                (x.createdAt as Date) <= t
            for (const s of named('Семейная')) {
                const t = s.createdAt as Date
                expect(
                    p.subscriptions.some((x) => x.userId !== s.userId && family.has(x.userId as string) && currentAt(t)(x)),
                ).toBe(true)
            }
            expect(named('Студенческая').length).toBeGreaterThanOrEqual(1)
            expect(named('Студенческая').length).toBeLessThanOrEqual(5)
            // «ПРОДЛИ5»: a few renewals since it appeared, once per member.
            const code = p.discounts.find((d) => d.code === 'ПРОДЛИ5')!
            const renewals = named('Продление −5%')
            expect(renewals.length).toBeGreaterThanOrEqual(1)
            expect(renewals.length).toBeLessThanOrEqual(3)
            expect(new Set(renewals.map((s) => s.userId)).size).toBe(renewals.length)
            for (const s of renewals) {
                expect((s.createdAt as Date) > (code.createdAt as Date)).toBe(true)
                expect(s.discountAmount).toBe(Math.round(((s.listPrice as number) * 5) / 100))
                expect(
                    p.subscriptions.some((x) => x.userId === s.userId && (x.createdAt as Date) < (s.createdAt as Date)),
                ).toBe(true)
            }
            for (const s of [...named('Семейная'), ...named('Студенческая')]) {
                const pct = s.discountName === 'Семейная' ? 10 : 15
                expect(s.discountAmount).toBe(Math.round(((s.listPrice as number) * pct) / 100))
                expect(s.amountPaid).toBe((s.listPrice as number) - (s.discountAmount as number))
            }
            // One-offs: the head coach's cash part-payment and an admin's 500 ₽.
            const oneOffs = p.subscriptions.filter((s) => !s.discountId && (s.amountPaid as number) < (s.listPrice as number))
            expect(oneOffs).toHaveLength(2)
            const coachId = p.accountUserIds.coach
            const coachCash = oneOffs.find((s) => s.pricedById === coachId)!
            expect(coachCash).toMatchObject({ isPaid: true, paymentMethod: 'CASH', markedPaidById: coachId })
            expect((coachCash.listPrice as number) - (coachCash.amountPaid as number)).toBe(1000)
            const adminOneOff = oneOffs.find((s) => s.pricedById === p.accountUserIds.admin)!
            expect((adminOneOff.listPrice as number) - (adminOneOff.amountPaid as number)).toBe(500)
            // Audited like a live sale: the head coach is the actor, the one-off in the metadata.
            const audit = p.auditEvents.find(
                (e) => e.action === 'member.assignSubscription' && e.actorId === coachId,
            )
            expect(audit?.metadata).toMatchObject({ listPrice: coachCash.listPrice, oneOff: 1000 })
            expect(p.auditEvents.filter((e) => e.action === 'discount.create')).toHaveLength(3)
            // The «абонемент заканчивается» promise is the promo code the product honours.
            expect(p.clubMessages.some((m) => (m.body as string).includes('ПРОДЛИ5'))).toBe(true)
            expect(p.clubMessages.some((m) => (m.body as string).includes('в день окончания'))).toBe(false)
        }
        check(plan)
        for (const days of [9, 17, 26]) check(build(new Date(NOW.getTime() + days * 86_400_000)))
    })

    it('gives adults and parents their own placeholder phone, children none', () => {
        const phones = plan.users.flatMap((u) => (u.phone ? [u.phone] : []))
        expect(new Set(phones).size).toBe(phones.length)
        expect(phones.every((p) => /^\+79001\d{6}$/.test(p))).toBe(true)
        for (const key of ['student', 'parent'] as const) {
            expect(plan.users.find((u) => u.id === plan.accountUserIds[key])?.phone).toMatch(/^\+79001/)
        }
        const children = new Set(plan.guardianships.map((g) => g.dependentId))
        expect(plan.users.filter((u) => children.has(u.id as string)).every((u) => u.phone === null)).toBe(true)
        const parents = new Set(plan.guardianships.map((g) => g.guardianId))
        expect(plan.users.filter((u) => parents.has(u.id as string)).every((u) => u.phone)).toBe(true)
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

    it('addresses the adults’ grading to the adult BJJ groups: student@ sees it, Миша does not', () => {
        const grading = plan.announcements.find((a) => a.title.startsWith('Аттестация взрослых'))
        expect(grading?.pinned).toBe(true)
        expect(grading?.directionId).toBeNull()
        const targets = new Set(
            plan.announcementGroups
                .filter((t) => t.announcementId === grading?.id)
                .map((t) => t.groupId),
        )
        expect([...targets].sort()).toEqual(
            GROUPS.filter((g) => g.dir === 'bjj' && g.kind === 'adult')
                .map((g) => demoUuid(`group:${g.key}`))
                .sort(),
        )
        const groupsOf = (userId: string) =>
            plan.groupMembers.filter((m) => m.userId === userId).map((m) => m.groupId)
        expect(groupsOf(plan.accountUserIds.student).some((g) => targets.has(g))).toBe(true)
        const misha = groupsOf(demoUuid('child:misha'))
        expect(misha.length).toBeGreaterThan(0)
        expect(misha.some((g) => targets.has(g))).toBe(false)
    })

    it('has the eight demo messages: a scheduled one, a direct to student@, one to Миша for Елена', () => {
        expect(plan.clubMessages).toHaveLength(8)
        expect(plan.workspace.messagesEmailEnabled).toBe(true)
        expect(plan.clubMessages.map((m) => m.segment)).toEqual([
            'ALL',
            'DIRECTION',
            'RENEW',
            'UNPAID',
            'INACTIVE',
            'MEMBERS',
            'MEMBERS',
            'ALL',
        ])
        const scheduled = plan.clubMessages.filter((m) => m.status === 'SCHEDULED')
        expect(scheduled.map((m) => m.title)).toEqual(['Расписание на праздники'])
        expect((scheduled[0].sendAt as Date) > NOW).toBe(true)
        // Counters match the recipient rows they summarise.
        for (const m of plan.clubMessages.filter((x) => x.status === 'SENT')) {
            const rows = plan.clubMessageRecipients.filter((r) => r.messageId === m.id)
            expect(m.recipientCount).toBe(rows.length)
            expect(m.readCount).toBe(rows.filter((r) => r.readAt).length)
            expect(m.pushCount).toBe(rows.filter((r) => r.pushSkip === null).length)
            expect(rows.length).toBeGreaterThan(0)
        }
        // The renewal message carries the promo code the product honours.
        expect(plan.clubMessages.some((m) => m.segment === 'RENEW' && (m.body as string).includes('ПРОДЛИ5'))).toBe(true)
        expect(plan.announcements.some((a) => a.audience === 'EXPIRING')).toBe(false)

        const student = plan.accountUserIds.student
        const kimono = plan.clubMessages.find((m) => m.title === 'Максим, возьмите кимоно на аттестацию')!
        expect(kimono).toMatchObject({ isDirect: true, memberIds: [student] })
        expect(plan.clubMessageRecipients.find((r) => r.messageId === kimono.id)).toMatchObject({
            userId: student,
            readAt: null,
            pushSkip: null,
        })
        expect(plan.notifications.find((n) => (n.metadata as { messageId: string }).messageId === kimono.id)).toMatchObject({
            userId: student,
            seen: false,
            metadata: { kind: 'message.direct', messageId: kimono.id },
        })

        const parent = plan.accountUserIds.parent
        const uniform = plan.clubMessages.find((m) => m.title === 'Форма на соревнования')!
        const mishaId = (uniform.memberIds as string[])[0]
        expect(plan.guardianships.some((g) => g.guardianId === parent && g.dependentId === mishaId)).toBe(true)
        expect(plan.notifications.find((n) => (n.metadata as { messageId: string }).messageId === uniform.id)).toMatchObject({
            userId: parent,
            topic: 'Миша: Форма на соревнования',
            metadata: { kind: 'message.direct', dependentId: mishaId },
        })
        // Only the fixed accounts have inbox rows.
        expect(new Set(plan.notifications.map((n) => n.userId))).toEqual(
            new Set([student, parent].filter((id) => plan.notifications.some((n) => n.userId === id))),
        )
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

    it('has an open video review of student@ for the staff', () => {
        const [review] = plan.videoReviews
        expect(plan.videoReviews).toHaveLength(1)
        expect(review).toMatchObject({ status: 'open', memberUserId: plan.accountUserIds.student })
        expect(plan.reviewClips).toEqual([
            expect.objectContaining({ id: review.clipId, status: 'processing', ownerUserId: plan.accountUserIds.student, rawBucket: 'clubspace' }),
        ])
    })

    it('sells tickets: the seminar full with a waitlist and student@ in it, the master class with places left', () => {
        const regs = (key: string) => {
            const event = plan.events.find((e) => e.id === demoUuid(`event:${key}`))!
            return { event, rows: plan.eventRegistrations.filter((r) => r.eventId === event.id) }
        }
        const seminar = regs('seminar')
        expect(seminar.event).toMatchObject({ price: 2500, capacity: 20, currency: 'RUB' })
        const booked = seminar.rows.filter((r) => r.status === 'BOOKED')
        expect(booked).toHaveLength(20)
        expect(seminar.rows.filter((r) => r.status === 'WAITLISTED')).toHaveLength(3)
        expect(booked.find((r) => r.userId === plan.accountUserIds.student)).toMatchObject({ isPaid: true, amountPaid: 2500 })
        expect(booked.some((r) => !r.isPaid)).toBe(true)
        const clinch = regs('muay-clinch')
        const clinchBooked = clinch.rows.filter((r) => r.status === 'BOOKED')
        expect(clinchBooked.length).toBeGreaterThan(0)
        expect(clinchBooked.length).toBeLessThan(clinch.event.capacity as number)
        for (const r of [...seminar.rows, ...clinch.rows]) {
            expect((r.createdAt as Date) <= NOW).toBe(true)
            if (r.isPaid) expect((r.paidAt as Date) <= NOW && (r.paidAt as Date) >= (r.createdAt as Date)).toBe(true)
        }
    })

    it('shows the ИИ-ассистент with tokens no secret can open', () => {
        expect(plan.aiTokens.map((t) => [t.name, t.revokedAt ? 'revoked' : 'active'])).toEqual([
            ['Claude — директор', 'active'],
            ['ChatGPT — проба', 'revoked'],
        ])
        // hashAiToken yields 64 hex characters; these never match one.
        for (const t of plan.aiTokens) expect(t.tokenHash).not.toMatch(/^[0-9a-f]{64}$/)
        expect(plan.aiTokens.every((t) => t.dataMode === 'PSEUDONYMIZED')).toBe(true)
        expect(plan.auditEvents.filter((e) => e.action === 'ai.toolCall').length).toBeGreaterThanOrEqual(5)
        expect(plan.auditEvents.every((e) => (e.createdAt as Date) <= NOW)).toBe(true)
    })

    it('has the ИИ-ассистент chat on with one saved conversation the model saw only under pseudonyms', () => {
        expect(plan.aiChatAcceptances).toEqual([
            expect.objectContaining({ warningVersion: AI_CHAT_DATA_WARNING.version, userEmail: 'owner@academy.demo' }),
        ])
        // Given for the chat, not for a token.
        expect(plan.aiChatAcceptances[0].tokenId).toBeUndefined()
        expect(plan.aiChatConversations).toHaveLength(1)
        const conversation = plan.aiChatConversations[0]
        const messages = parseStoredMessages(conversation.messages)
        expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
        // Its question is counted against the monthly limit, as a live one.
        expect(plan.aiChatUsages).toEqual([
            expect.objectContaining({ conversationId: conversation.id, createdAt: conversation.createdAt }),
        ])
        const refs = parseStoredRefs(conversation.refs)
        expect(Object.keys(refs)).toHaveLength(3)
        const modelSide = JSON.stringify(messages.map((m) => ('content' in m ? m.content : '')))
        for (const [ref, person] of Object.entries(refs)) {
            expect(ref).toBe(pseudonymFor('demo-secret', plan.workspaceId, person.userId, 'member'))
            expect(modelSide).toContain(ref)
            const user = plan.users.find((u) => u.id === person.userId)!
            expect(modelSide).not.toContain(user.lastname!)
            if (user.phone) expect(modelSide).not.toContain(user.phone)
        }
        const [turn] = deriveTurns(messages)
        expect(turn.steps).toEqual([{ tool: 'at_risk_members', label: 'Смотрю, кто может уйти…', isError: false }])
        expect(extractEntityTokens([turn.answer]).groups.size).toBeGreaterThan(0)
    })

    it('has a booking group with full classes, a waitlist, no-shows and bookings of parent@', () => {
        const group = plan.groups.find((g) => g.bookingMode === 'BOOKING')!
        expect(group).toMatchObject({ capacity: 12, directionId: null })
        const classes = plan.classOccurrences.filter((o) => o.groupId === group.id)
        const bookingsOf = (id: string) => plan.classBookings.filter((b) => b.occurrenceId === id)
        const ahead = classes.filter((o) => (o.startAt as Date) > NOW)
        expect(ahead.every((o) => o.settledAt === null)).toBe(true)
        expect(
            ahead.some((o) => {
                const rows = bookingsOf(o.id as string)
                return rows.filter((b) => b.status === 'BOOKED').length === 12 && rows.some((b) => b.status === 'WAITLISTED')
            }),
        ).toBe(true)
        const past = classes.filter((o) => (o.startAt as Date) < NOW)
        expect(past.length).toBeGreaterThanOrEqual(8)
        expect(past.every((o) => o.settledAt)).toBe(true)
        const statuses = new Set(plan.classBookings.map((b) => b.status))
        for (const s of ['ATTENDED', 'NO_SHOW', 'LATE_CANCELLED', 'BOOKED', 'WAITLISTED'] as const) {
            expect(statuses.has(s)).toBe(true)
        }
        // Every attended booking has its mark; a burn points at a pack.
        const sessions = new Map(plan.sessions.map((s) => [s.id, s.occurrenceKey]))
        const marked = new Set(plan.records.map((r) => `${sessions.get(r.sessionId)}:${r.userId}`))
        const keyOf = new Map(classes.map((o) => [o.id, o.occurrenceKey]))
        for (const b of plan.classBookings) {
            expect(marked.has(`${keyOf.get(b.occurrenceId)}:${b.userId}`)).toBe(b.status === 'ATTENDED')
        }
        const subs = new Map(plan.subscriptions.map((s) => [s.id, s]))
        const burned = plan.classBookings.filter((b) => b.classBurned)
        expect(burned.every((b) => subs.get(b.burnedSubscriptionId as string)?.classesTotal)).toBe(true)
        const mine = plan.classBookings.filter((b) => b.userId === plan.accountUserIds.parent)
        expect(mine.some((b) => b.status === 'BOOKED' || b.status === 'WAITLISTED')).toBe(true)
        expect(mine.some((b) => b.status === 'ATTENDED')).toBe(true)
    })

    it('has three birthdays today on every reset: Аня, an adult and a kid of other groups', () => {
        const leapDay = new Date('2028-02-29T09:30:00.000Z')
        for (const [day, now] of [[plan, NOW], [build(leapDay), leapDay]] as const) {
            const ids = birthdaysToday(day, localDateInTz(now, TZ))
            expect(ids).toHaveLength(3)
            expect(ids).toContain(demoUuid('child:anya'))
            const groupsOf = (userId: string) =>
                day.groupMembers.filter((g) => g.userId === userId).map((g) => g.groupId)
            const others = ids.filter((id) => id !== demoUuid('child:anya'))
            // One adult (an e-mail) and one child (none).
            expect(others.map((id) => day.users.find((u) => u.id === id)?.email === null).sort()).toEqual([
                false,
                true,
            ])
            // Outside Аня's group: each coach sees their own.
            const anyaGroups = groupsOf(demoUuid('child:anya'))
            for (const id of others) {
                expect(groupsOf(id).length).toBeGreaterThan(0)
                expect(groupsOf(id).some((g) => anyaGroups.includes(g))).toBe(false)
            }
        }
        const anya = plan.users.find((u) => u.id === demoUuid('child:anya'))
        expect((anya?.dateOfBirth as Date).toISOString().slice(0, 10)).toBe('2019-11-04')
    })

    // «Пробные» (docs/design/2026-11-26-leads.md §9).
    it('seeds 16 leads across the pipeline; the bought ones bought after asking', () => {
        const count = (status: string) => plan.leads.filter((l) => l.status === status).length
        expect(plan.leads).toHaveLength(16)
        expect([count('NEW'), count('CONTACTED'), count('TRIAL_BOOKED'), count('CAME'), count('LOST')]).toEqual([3, 2, 2, 6, 3])
        expect(new Set(plan.leads.map((l) => l.source))).toEqual(new Set(['PUBLIC_PAGE', 'QR', 'MANUAL']))
        expect(plan.leads.filter((l) => l.forChild).length).toBeGreaterThanOrEqual(3)
        const sold = plan.subscriptions.filter((s) => s.isPaid && (s.amountPaid as number) > 0)
        const bought = plan.leads.filter((l) =>
            sold.some((s) => s.userId === l.convertedUserId && (s.createdAt as Date) > (l.createdAt as Date)),
        )
        expect(bought).toHaveLength(4)
        const linkedNoAbonement = plan.leads.filter(
            (l) => l.convertedUserId && !sold.some((s) => s.userId === l.convertedUserId),
        )
        expect(linkedNoAbonement).toHaveLength(1)
        // A NEW lead older than a day drives «ждут больше суток».
        expect(plan.leads.some((l) => l.status === 'NEW' && NOW.getTime() - (l.createdAt as Date).getTime() > 24 * 3600_000)).toBe(true)
        // Lead phones never collide with members' placeholders.
        const memberPhones = new Set(plan.users.map((u) => u.phone))
        expect(plan.leads.some((l) => memberPhones.has(l.phone))).toBe(false)
        // The form stays off while the DPA in force predates lead subjects.
        expect(plan.workspace).toMatchObject({ trialRequestsEnabled: false, pdOperatorName: expect.any(String) })
    })

    it('pays coaches: rates, a raise this month, and last month to close with a substitute, a cancelled class and a bonus', () => {
        expect(plan.workspace.coachPayVisible).toBe(true)
        const ratesOf = (k: string) => plan.coachRates.filter((r) => r.coachId === demoUuid(`staff:${k}`))
        expect(ratesOf('savelyev')).toEqual([expect.objectContaining({ fixedMonthly: 40000, revenueBp: 1000 })])
        expect(ratesOf('vlasov')).toEqual([
            expect.objectContaining({ perClass: 1500, perClassMinStudents: 3, perStudent: 100 }),
        ])
        expect(ratesOf('reshetyuk').map((r) => [(r.effectiveFrom as Date).toISOString().slice(0, 7), r.perClass])).toEqual([
            ['2026-05', 2000],
            ['2026-11', 2500],
        ])
        expect(plan.payrollClose).toMatchObject({ month: '2026-10', closedById: demoUuid('staff:admin') })
        expect(plan.payrollClose!.closedAt.getTime()).toBeLessThan(NOW.getTime())
        expect(plan.payrollAdjustments).toEqual([
            expect.objectContaining({ amount: 5000, comment: 'Открытый урок', coachId: demoUuid('staff:savelyev') }),
        ])

        // The payroll rule over last month's rows: the class Савельев took is
        // his, the one cancelled after its roster was opened drops out.
        const sessions = plan.sessions.map((s) => ({
            id: s.id as string,
            groupId: (s.groupId as string | null) ?? null,
            groupName: null,
            groupCoachIds: [],
            groupPrimaryCoachId: null,
            scheduledSlotId: (s.slotId as string | null) ?? null,
            sessionDate: s.sessionDate ? (s.sessionDate as Date).toISOString().slice(0, 10) : '',
            startAt: s.startAt as Date,
            isPersonal: s.isPersonal ?? false,
            workspaceEventId: (s.workspaceEventId as string | null) ?? null,
            coachId: (s.coachId as string | null) ?? null,
            records: plan.records.filter((r) => r.sessionId === s.id).map((r) => ({ userId: r.userId, usedSubscriptionId: null })),
        }))
        const exceptions = plan.scheduleExceptions.map((e) => ({
            groupId: e.groupId,
            slotId: e.slotId ?? null,
            fromDate: e.fromDate as Date,
            untilDate: e.untilDate as Date,
        }))
        const { counted, cancelled } = countedClasses('2026-10', sessions, exceptions)
        const substitution = plan.classSubstitutions.find((s) => s.id === demoUuid('substitution:payroll'))!
        const covered = counted.find((c) => `slot:${sessions.find((s) => s.id === c.sessionId)!.scheduledSlotId}:${c.date}` === substitution.occurrenceKey)
        expect(covered?.coachId).toBe(demoUuid('staff:savelyev'))
        expect(cancelled).toHaveLength(1)
        expect(cancelled[0].groupId).toBe(demoUuid('group:yuKidsJunior'))
        expect(cancelled[0].marks).toBeGreaterThan(0)
    })

    it('moves every date with today', () => {
        const later = build(new Date(NOW.getTime() + 7 * 86_400_000))
        const max = (p: DemoClubPlan) => Math.max(...p.sessions.map((s) => (s.startAt as Date).getTime()))
        expect(max(later) - max(plan)).toBeGreaterThan(5 * 86_400_000)
        expect(later.workspaceId).toBe(plan.workspaceId)
        expect(later.groups).toHaveLength(GROUPS.length + 1)
    })

    it('mutes only a few students (a message preview must not read «выключили — 31»)', () => {
        const muted = students(plan).filter((m) => m.data.notificationsMuted)
        expect(muted.length).toBeGreaterThanOrEqual(2)
        expect(muted.length).toBeLessThanOrEqual(3)
        const accounts = new Set(Object.values(plan.accountUserIds))
        expect(muted.some((m) => accounts.has(m.data.userId as string))).toBe(false)
    })

    it("message rows say «muted» exactly for the members who muted the club; the rest have no device", () => {
        const mutedIds = new Set(
            plan.members.filter((m) => m.data.notificationsMuted).map((m) => m.data.userId as string),
        )
        const broadcastIds = new Set(
            plan.clubMessages.filter((m) => !m.isDirect && !m.isService).map((m) => m.id as string),
        )
        const rows = plan.clubMessageRecipients.filter((r) => broadcastIds.has(r.messageId))
        expect(rows.length).toBeGreaterThan(0)
        for (const r of rows) {
            if (mutedIds.has(r.userId)) expect(r.pushSkip).toBe('muted')
            else expect(r.pushSkip).not.toBe('muted')
            if (r.pushSkip === 'muted') expect(r.emailedAt).toBeNull()
        }
        expect(rows.filter((r) => r.pushSkip === 'muted').length).toBeLessThan(rows.length / 10)
    })
})
