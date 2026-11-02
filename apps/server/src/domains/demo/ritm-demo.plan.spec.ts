import { localDateInTz } from '../../features/attendance/attendance-utils'
import { deriveTurns, parseStoredMessages, parseStoredRefs } from '../../features/ai-chat/ai-chat-utils'
import { AI_CHAT_DATA_WARNING } from '../ai-assistant/ai-chat-warning'
import { pseudonymFor } from '../ai-assistant/pseudonym'
import { averageRetention, buildCohorts } from '../analytics/cohorts'
import { type ForecastSubscription, renewalHistory } from '../analytics/forecast'
import { evaluateMemberRisk, RISK_RULES } from '../retention/risk-signals'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'
import { buildDemoClubPlan, type DemoClubPlan } from './demo-club.plan'
import { buildRitmDemoPlan } from './ritm-demo.plan'
import { RITM_ACCOUNTS, RITM_CLUB_KEY, RITM_PARENT_CHILDREN } from './ritm-demo.accounts'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const TZ = 'Asia/Tomsk'
const DAY = 86_400_000
const INPUT = {
    timezone: TZ,
    personalDataConsentVersion: '2026-11-01',
    legal: { offerVersion: 'offer-1', dpaVersion: 'dpa-1' },
    pseudonymSecret: 'demo-secret',
}
const build = (now: Date = NOW) => buildRitmDemoPlan({ ...INPUT, now })
type Plan = DemoClubPlan

const visitsByUser = (plan: Plan) => {
    const visits = new Map<string, Date[]>()
    for (const r of plan.records) visits.set(r.userId, [...(visits.get(r.userId) ?? []), r.markedAt as Date])
    for (const list of visits.values()) list.sort((a, b) => a.getTime() - b.getTime())
    return visits
}

// «Кто пропадает» as load-workspace-risk.ts builds it, over the plan's rows
// (the writer starts the live freezes today).
const atRiskIds = (plan: Plan, now: Date): string[] => {
    const dirs = new Map<string, string[]>()
    for (const d of plan.subscriptionDirections) dirs.set(d.subscriptionId, [...(dirs.get(d.subscriptionId) ?? []), d.directionId])
    const planName = new Map(plan.plans.map((p) => [p.id, p.name]))
    const visits = visitsByUser(plan)
    const frozen = new Set(plan.liveFreezes.map((f) => f.subscriptionId))
    const lapseStart = now.getTime() - RISK_RULES.lapsedWindowDays * DAY
    return plan.members
        .filter((m) => m.role === 'user' && m.data.status === 'ACTIVE')
        .map((m) => m.data.userId)
        .filter((userId) => {
            const subs = plan.subscriptions
                .filter((s) => s.userId === userId && s.status !== 'CANCELLED')
                .map((s) => ({
                    id: s.id as string,
                    status: s.status as string,
                    endDate: (s.endDate as Date | null) ?? null,
                    classesRemaining: s.classesRemaining ?? null,
                    planName: planName.get(s.planId) as string,
                    directionIds: dirs.get(s.id as string) ?? [],
                }))
                .filter(
                    (s) =>
                        isSubscriptionUsable(s, now) ||
                        (s.endDate !== null && s.endDate.getTime() > lapseStart && s.endDate <= now),
                )
            const current = subs.filter((s) => isSubscriptionUsable(s, now))
            const v = visits.get(userId) ?? []
            const member = plan.members.find((m) => m.data.userId === userId)!
            return (
                evaluateMemberRisk({
                    now,
                    tz: TZ,
                    attendanceActive: true,
                    firstVisitAt: v[0] ?? null,
                    lastVisitAt: v.at(-1) ?? null,
                    windowVisits: v.filter((x) => x.getTime() >= now.getTime() - RISK_RULES.windowDays * DAY),
                    frozenNow: current.length > 0 && current.every((s) => frozen.has(s.id)),
                    lastFreezeEndAt: null,
                    subscriptions: subs,
                    accessUntil: (member.data.accessUntil as Date | null | undefined) ?? null,
                }) !== null
            )
        })
}

describe('buildRitmDemoPlan', () => {
    const plan = build()
    const academy = buildDemoClubPlan({ ...INPUT, now: NOW })
    const students = plan.members.filter((m) => m.role === 'user')
    const kidIds = new Set(
        plan.users
            .filter((u) => u.dateOfBirth && NOW.getTime() - new Date(u.dateOfBirth).getTime() < 14 * 365.25 * 86_400_000)
            .map((u) => u.id),
    )

    it('is deterministic for the same day', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(plan))
    })

    it('is a dance studio at its own key, with ranks off and videos on', () => {
        expect(plan.workspace).toMatchObject({
            key: RITM_CLUB_KEY,
            type: 'DANCE',
            isDemo: true,
            ranksEnabled: false,
            videosEnabled: true,
        })
        expect(plan.ladders).toHaveLength(0)
        expect(plan.levels).toHaveLength(0)
        expect(plan.promotions).toHaveLength(0)
        expect(plan.gradings).toHaveLength(0)
        expect(plan.gyms).toHaveLength(2)
        expect(plan.directions.map((d) => d.name)).toEqual(['High heels', 'Hip-hop', 'Contemporary', 'Растяжка', 'Детские группы', 'Мастер-классы'])
    })

    it('shares no id, address or phone with ACADEMY', () => {
        const ids = (p: typeof plan) => new Set([p.workspaceId, ...p.users.map((u) => u.id), ...p.groups.map((g) => g.id), ...p.subscriptions.map((s) => s.id)])
        const academyIds = ids(academy)
        expect([...ids(plan)].filter((id) => academyIds.has(id as string))).toEqual([])
        const academyEmails = new Set(academy.users.map((u) => u.email).filter(Boolean))
        expect(plan.users.filter((u) => u.email && academyEmails.has(u.email))).toEqual([])
        expect(plan.users.every((u) => !u.email || u.email.endsWith('@ritm.demo'))).toBe(true)
        const academyPhones = new Set(academy.users.map((u) => u.phone).filter(Boolean))
        expect(plan.users.filter((u) => u.phone && academyPhones.has(u.phone))).toEqual([])
        const phones = plan.users.map((u) => u.phone).filter(Boolean)
        expect(new Set(phones).size).toBe(phones.length)
        expect(plan.joinCode).not.toBe(academy.joinCode)
    })

    it('has ~70 students, about a third children, all with a parent', () => {
        expect(students.length).toBeGreaterThanOrEqual(60)
        expect(students.length).toBeLessThanOrEqual(80)
        const kids = students.filter((m) => kidIds.has(m.data.userId))
        expect(kids.length / students.length).toBeGreaterThan(0.25)
        expect(kids.length / students.length).toBeLessThan(0.4)
        for (const k of kids) {
            expect(plan.guardianships.some((g) => g.dependentId === k.data.userId)).toBe(true)
            expect(plan.users.find((u) => u.id === k.data.userId)?.email).toBeNull()
        }
        expect(plan.guardianships.filter((g) => g.consentAt).length).toBeGreaterThan(plan.guardianships.filter((g) => !g.consentAt).length)
    })

    it('gives the fixed accounts their roles and the parent her two children', () => {
        for (const a of RITM_ACCOUNTS) {
            const id = plan.accountUserIds[a.key]
            expect(plan.users.find((u) => u.id === id)?.email).toBe(a.email)
            expect(plan.members.some((m) => m.data.userId === id)).toBe(true)
        }
        expect(plan.workspace.ownerId).toBe(plan.accountUserIds.owner)
        expect(plan.members.find((m) => m.data.userId === plan.accountUserIds.owner)?.role).toBe('admin')
        expect(plan.members.find((m) => m.data.userId === plan.accountUserIds.coach)?.role).toBe('coach')
        const children = plan.guardianships.filter((g) => g.guardianId === plan.accountUserIds.parent)
        expect(children).toHaveLength(RITM_PARENT_CHILDREN.length)
        expect(children.every((g) => g.consentAt)).toBe(true)
        const names = children.map((g) => plan.users.find((u) => u.id === g.dependentId)?.firstname)
        expect(names).toEqual(RITM_PARENT_CHILDREN.map((c) => c.firstname))
    })

    it('sells 4/8/12, a single and a free trial; the student holds a running 8', () => {
        expect(plan.plans.map((p) => p.classCount)).toEqual(expect.arrayContaining([1, 4, 8, 12]))
        expect(plan.plans.find((p) => p.isFreeTrial)?.price).toBe(0)
        expect(plan.plans.some((p) => /Разовое/.test(p.name))).toBe(true)
        const master = plan.directions.find((d) => d.name === 'Мастер-классы')!.id
        expect(plan.planDirections.some((d) => d.directionId === master)).toBe(false)
        const live = plan.subscriptions.filter(
            (s) => s.userId === plan.accountUserIds.student && new Date(s.startDate as Date) <= NOW && NOW < new Date(s.endDate as Date),
        )
        expect(live.some((s) => s.classesTotal === 8 && (s.classesRemaining ?? 0) > 0)).toBe(true)
    })

    it('has a year of visits on schedule, charged to abonements', () => {
        const today = localDateInTz(NOW, TZ)
        const dates = plan.sessions.filter((s) => s.sessionDate).map((s) => new Date(s.sessionDate as Date).toISOString().slice(0, 10)).sort()
        expect(Date.parse(today) - Date.parse(dates[0])).toBeGreaterThanOrEqual(365 * 86_400_000)
        expect(dates.at(-1)! < today).toBe(true)
        expect(plan.records.length).toBeGreaterThan(3000)
        const sessionIds = new Set(plan.sessions.map((s) => s.id))
        expect(plan.records.every((r) => sessionIds.has(r.sessionId))).toBe(true)
        const groupSessions = new Set(plan.sessions.filter((s) => s.groupId).map((s) => s.id))
        expect(plan.records.filter((r) => groupSessions.has(r.sessionId)).every((r) => r.usedSubscriptionId)).toBe(true)
        expect(plan.subscriptions.every((s) => (s.classesRemaining ?? 0) >= 0)).toBe(true)
    })

    it('looks like a healthy studio: about one in ten at risk, the demo people never', () => {
        for (let d = 0; d < 7; d++) {
            const now = new Date(NOW.getTime() + d * DAY + d * 3 * 60 * 60_000)
            const day = build(now)
            const risky = atRiskIds(day, now)
            const share = risky.length / day.members.filter((m) => m.role === 'user').length
            expect(share).toBeGreaterThanOrEqual(0.05)
            expect(share).toBeLessThanOrEqual(0.13)
            for (const key of ['student', 'parent'] as const) expect(risky).not.toContain(day.accountUserIds[key])
            for (const g of day.guardianships.filter((x) => x.guardianId === day.accountUserIds.parent)) {
                expect(risky).not.toContain(g.dependentId)
            }
        }
    })

    it('renews about four abonements in five and keeps its cohorts like a healthy studio', () => {
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
        expect(due).toBeGreaterThan(250)
        expect(done / due).toBeGreaterThan(0.75)
        expect(done / due).toBeLessThan(0.86)
        const spans = [...visitsByUser(plan).entries()].map(([userId, v]) => ({
            userId,
            firstVisitAt: v[0],
            lastVisitAt: v.at(-1)!,
            visits: v.length,
        }))
        const [m1, m2, m3, m6] = averageRetention(buildCohorts(spans, { now: NOW, tz: TZ })).map((c) => c.rate!)
        expect(m1).toBeGreaterThan(0.7)
        expect(m1).toBeLessThan(0.93)
        expect(m3).toBeLessThan(m1)
        expect(m3).toBeGreaterThan(0.5)
        expect(m6).toBeLessThan(0.72)
        expect(m2).toBeGreaterThanOrEqual(m3)
    })

    it('keeps those who left: visits and abonements without a membership, six weeks old at least', () => {
        const memberIds = new Set(plan.members.map((m) => m.data.userId))
        const left = new Set(plan.records.map((r) => r.userId).filter((id) => !memberIds.has(id)))
        expect(left.size).toBeGreaterThanOrEqual(25)
        expect(plan.groupMembers.some((g) => left.has(g.userId))).toBe(false)
        const sixWeeks = localDateInTz(new Date(NOW.getTime() - 42 * DAY), TZ)
        expect(plan.records.filter((r) => left.has(r.userId)).every((r) => localDateInTz(r.markedAt as Date, TZ) <= sixWeeks)).toBe(true)
        const kept = plan.subscriptions.filter((s) => s.workspaceMemberId === null)
        expect(kept.length).toBeGreaterThan(0)
        expect(kept.every((s) => left.has(s.userId as string))).toBe(true)
    })

    it('records how every paid sale was paid', () => {
        const paid = plan.subscriptions.filter((s) => s.isPaid && (s.amountPaid ?? 0) > 0)
        expect(paid.every((s) => s.paymentMethod === 'CASH' || s.paymentMethod === 'TRANSFER' || s.paymentMethod === 'CARD')).toBe(true)
        expect(new Set(paid.map((s) => s.paymentMethod)).size).toBe(3)
        expect(plan.subscriptions.filter((s) => !s.isPaid || s.amountPaid === 0).every((s) => s.paymentMethod === null)).toBe(true)
    })

    it('has «Растяжка» by booking: full classes with a waitlist, student@ booked and parent@ first in line', () => {
        const group = plan.groups.find((g) => g.bookingMode === 'BOOKING')!
        const stretch = plan.directions.find((d) => d.name === 'Растяжка')!
        expect(group).toMatchObject({ capacity: 10, directionId: stretch.id, coachId: plan.accountUserIds.coach })
        const classes = plan.classOccurrences.filter((o) => o.groupId === group.id)
        const bookingsOf = (id: string) => plan.classBookings.filter((b) => b.occurrenceId === id)
        const ahead = classes.filter((o) => (o.startAt as Date) > NOW).sort((a, b) => +(a.startAt as Date) - +(b.startAt as Date))
        expect(ahead.every((o) => o.settledAt === null)).toBe(true)
        const nearest = bookingsOf(ahead[0].id as string)
        expect(nearest.filter((b) => b.status === 'BOOKED')).toHaveLength(10)
        const queue = nearest.filter((b) => b.status === 'WAITLISTED').sort((a, b) => +(a.createdAt as Date) - +(b.createdAt as Date))
        expect(queue.length).toBeGreaterThanOrEqual(2)
        expect(queue[0].userId).toBe(plan.accountUserIds.parent)
        expect(nearest.some((b) => b.status === 'BOOKED' && b.userId === plan.accountUserIds.student)).toBe(true)
        const past = classes.filter((o) => (o.startAt as Date) < NOW)
        expect(past.length).toBeGreaterThanOrEqual(8)
        expect(past.every((o) => o.settledAt)).toBe(true)
        const statuses = new Set(plan.classBookings.map((b) => b.status))
        for (const s of ['ATTENDED', 'NO_SHOW', 'LATE_CANCELLED', 'CANCELLED', 'BOOKED', 'WAITLISTED'] as const) {
            expect(statuses.has(s)).toBe(true)
        }
        // Every attended booking has its mark, charged to an abonement; a burn points at a pack.
        const sessions = new Map(plan.sessions.map((s) => [s.id, s.occurrenceKey]))
        const marked = new Map(plan.records.map((r) => [`${sessions.get(r.sessionId)}:${r.userId}`, r]))
        const keyOf = new Map(classes.map((o) => [o.id, o.occurrenceKey]))
        for (const b of plan.classBookings) {
            const mark = marked.get(`${keyOf.get(b.occurrenceId)}:${b.userId}`)
            expect(!!mark).toBe(b.status === 'ATTENDED')
            if (mark) expect(mark.usedSubscriptionId).toBeTruthy()
        }
        const subs = new Map(plan.subscriptions.map((s) => [s.id, s]))
        expect(plan.classBookings.filter((b) => b.classBurned).every((b) => subs.get(b.burnedSubscriptionId as string)?.classesTotal)).toBe(true)
    })

    it('has a freeze, a freeze request for pedagog@ and a substitution student@ sees', () => {
        expect(plan.liveFreezes).toHaveLength(1)
        const [request] = plan.freezeRequests
        expect(plan.freezeRequests).toHaveLength(1)
        expect(request).toMatchObject({ status: 'PENDING', pendingSubscriptionId: request.subscriptionId })
        expect(request.userId).not.toBe(plan.liveFreezes[0].userId)
        const pedagogGroups = new Set(plan.groups.filter((g) => g.coachId === plan.accountUserIds.coach).map((g) => g.id))
        expect(plan.groupMembers.some((m) => m.userId === request.userId && pedagogGroups.has(m.groupId))).toBe(true)
        const sub = plan.subscriptions.find((s) => s.id === request.subscriptionId)!
        expect((sub.endDate as Date) > NOW && sub.isPaid).toBe(true)
        const [substitution] = plan.classSubstitutions
        expect(plan.classSubstitutions).toHaveLength(1)
        expect(substitution).toMatchObject({ status: 'APPROVED', substituteId: plan.accountUserIds.coach })
        expect((substitution.sessionDate as Date).toISOString().slice(0, 10) > localDateInTz(NOW, TZ)).toBe(true)
        expect(plan.groupMembers.some((m) => m.userId === plan.accountUserIds.student && m.groupId === substitution.groupId)).toBe(true)
    })

    it('has the owner’s ИИ-чат with one saved question counted against the limit, pseudonyms only', () => {
        expect(plan.aiChatAcceptances).toEqual([
            expect.objectContaining({ warningVersion: AI_CHAT_DATA_WARNING.version, userEmail: 'owner@ritm.demo' }),
        ])
        const [conversation] = plan.aiChatConversations
        expect(plan.aiChatConversations).toHaveLength(1)
        expect(plan.aiChatUsages).toEqual([
            expect.objectContaining({ conversationId: conversation.id, createdAt: conversation.createdAt, userId: plan.accountUserIds.owner }),
        ])
        const messages = parseStoredMessages(conversation.messages)
        expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
        const refs = parseStoredRefs(conversation.refs)
        expect(Object.keys(refs).length).toBeGreaterThanOrEqual(2)
        const modelSide = JSON.stringify(messages.map((m) => ('content' in m ? m.content : '')))
        for (const [ref, person] of Object.entries(refs)) {
            expect(ref).toBe(pseudonymFor('demo-secret', plan.workspaceId, person.userId, 'member'))
            const user = plan.users.find((u) => u.id === person.userId)!
            expect(modelSide).toContain(ref)
            expect(modelSide).not.toContain(user.lastname!)
            if (user.phone) expect(modelSide).not.toContain(user.phone)
        }
        expect(deriveTurns(messages)[0].steps).toEqual([{ tool: 'at_risk_members', label: 'Смотрю, кто может уйти…', isError: false }])
        expect(plan.journal.length).toBeGreaterThanOrEqual(2)
        expect(plan.journal.every((j) => j.userId === plan.accountUserIds.student)).toBe(true)
        expect(plan.auditEvents.length).toBeGreaterThanOrEqual(3)
        expect(plan.auditEvents.every((e) => (e.createdAt as Date) <= NOW)).toBe(true)
        expect(plan.retentionContacts.length).toBeGreaterThanOrEqual(1)
    })

    it('has a paid master class with every place taken and a waitlist, the parent first in line', () => {
        const next = plan.events.find((e) => e.title === 'Мастер-класс: dancehall')!
        expect(next).toMatchObject({ price: 1800, capacity: 16 })
        expect(new Date(next.startAt) > NOW).toBe(true)
        expect(next.hostName).toBeTruthy()
        const regs = plan.eventRegistrations.filter((r) => r.eventId === next.id)
        expect(regs.filter((r) => r.status === 'BOOKED')).toHaveLength(16)
        const queue = regs.filter((r) => r.status === 'WAITLISTED').sort((a, b) => +new Date(a.createdAt as Date) - +new Date(b.createdAt as Date))
        expect(queue.length).toBeGreaterThanOrEqual(2)
        expect(queue[0].userId).toBe(plan.accountUserIds.parent)
        expect(regs.some((r) => r.status === 'BOOKED' && r.userId === plan.accountUserIds.student)).toBe(true)
        expect(new Set(regs.map((r) => r.userId)).size).toBe(regs.length)
        expect(regs.filter((r) => r.isPaid).every((r) => r.amountPaid === 1800 && r.paymentMethod)).toBe(true)
        // The past one was paid by ticket: its visits never draw on an abonement.
        const past = plan.events.find((e) => e.title === 'Мастер-класс: Vogue')!
        const session = plan.sessions.find((s) => s.workspaceEventId === past.id)!
        const visits = plan.records.filter((r) => r.sessionId === session.id)
        expect(visits.length).toBeGreaterThan(5)
        expect(visits.every((r) => r.usedSubscriptionId === null)).toBe(true)
    })

    it('has videos of combinations for the studio directions', () => {
        expect(plan.courses.length).toBeGreaterThanOrEqual(2)
        expect(plan.videos.length).toBeGreaterThanOrEqual(5)
        expect(plan.courseAudiences.every((a) => plan.directions.some((d) => d.id === a.directionId))).toBe(true)
    })

    it('speaks the studio vocabulary: «занятие / педагог», no belts or «тренировка»', () => {
        const texts = JSON.stringify([
            plan.workspace,
            plan.plans,
            plan.groups,
            plan.events,
            plan.announcements,
            plan.courses,
            plan.chapters,
            plan.videos,
            plan.achievements,
            plan.users.map((u) => u.description),
            plan.journal,
            plan.liveFreezes,
            plan.freezeRequests,
            plan.retentionContacts,
            plan.aiChatConversations,
            RITM_ACCOUNTS,
        ])
        expect(texts).not.toMatch(/тренир|тренер|пояс|ранг|аттестац|татами|ковёр/i)
        expect(texts).toMatch(/занятие/)
        expect(texts).toMatch(/[Пп]едагог/)
    })

    it('moves with today: the same people, dates shifted', () => {
        const later = build(new Date(NOW.getTime() + 7 * 86_400_000))
        expect(later.members.length).toBe(plan.members.length)
        expect(later.workspaceId).toBe(plan.workspaceId)
        expect(later.accountUserIds).toEqual(plan.accountUserIds)
    })
})
