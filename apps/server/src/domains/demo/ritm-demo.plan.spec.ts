import { localDateInTz } from '../../features/attendance/attendance-utils'
import { buildDemoClubPlan } from './demo-club.plan'
import { buildRitmDemoPlan } from './ritm-demo.plan'
import { RITM_ACCOUNTS, RITM_CLUB_KEY, RITM_PARENT_CHILDREN } from './ritm-demo.accounts'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const TZ = 'Asia/Tomsk'
const INPUT = {
    timezone: TZ,
    personalDataConsentVersion: '2026-11-01',
    legal: { offerVersion: 'offer-1', dpaVersion: 'dpa-1' },
    pseudonymSecret: 'demo-secret',
}
const build = (now: Date = NOW) => buildRitmDemoPlan({ ...INPUT, now })

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
        expect(plan.directions.map((d) => d.name)).toEqual(['High heels', 'Hip-hop', 'Contemporary', 'Детские группы', 'Мастер-классы'])
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

    it('has three months of visits on schedule, charged to abonements', () => {
        const today = localDateInTz(NOW, TZ)
        const dates = plan.sessions.filter((s) => s.sessionDate).map((s) => new Date(s.sessionDate as Date).toISOString().slice(0, 10)).sort()
        expect(Date.parse(today) - Date.parse(dates[0])).toBeGreaterThanOrEqual(85 * 86_400_000)
        expect(dates.at(-1)! < today).toBe(true)
        expect(plan.records.length).toBeGreaterThan(1000)
        const sessionIds = new Set(plan.sessions.map((s) => s.id))
        expect(plan.records.every((r) => sessionIds.has(r.sessionId))).toBe(true)
        const groupSessions = new Set(plan.sessions.filter((s) => s.groupId).map((s) => s.id))
        expect(plan.records.filter((r) => groupSessions.has(r.sessionId)).every((r) => r.usedSubscriptionId)).toBe(true)
        expect(plan.subscriptions.every((s) => (s.classesRemaining ?? 0) >= 0)).toBe(true)
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
