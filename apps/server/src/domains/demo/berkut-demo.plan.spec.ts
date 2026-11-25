import { localDateInTz } from '../../features/attendance/attendance-utils'
import { computeRevenue } from '../metrics/revenue'
import { BERKUT_ACCOUNTS, BERKUT_CLUB_KEY, BERKUT_JOIN_CODE } from './berkut-demo.accounts'
import { BERKUT_HISTORY_DAYS, buildBerkutDemoPlan } from './berkut-demo.plan'
import { buildDemoClubPlan, type DemoClubPlan } from './demo-club.plan'
import { DEMO_ORG_ID, DEMO_ORG_TEMPLATES, demoOrgTemplateId, demoOrgTemplateLevelId } from './demo-organization'
import { buildRitmDemoPlan } from './ritm-demo.plan'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const TZ = 'Asia/Tomsk'
const DAY = 86_400_000
const INPUT = {
    timezone: TZ,
    personalDataConsentVersion: '2026-11-01',
    legal: { offerVersion: 'offer-1', dpaVersion: 'dpa-1' },
    pseudonymSecret: 'demo-secret',
}
const build = (now: Date = NOW) => buildBerkutDemoPlan({ ...INPUT, now })

// metric `mrr` (loadMonthlyRecurringIncome) over the plan's rows: the current
// abonements of members (currentSubscriptionWhere), as the federation console
// shows it once the club opened «Регулярный доход в месяц».
const mrrOf = (plan: DemoClubPlan, now: Date) =>
    computeRevenue(
        plan.subscriptions
            .filter(
                (s) =>
                    s.workspaceMemberId != null &&
                    s.status === 'ACTIVE' &&
                    (s.endDate == null || (s.endDate as Date) > now) &&
                    (s.createdAt as Date) <= now,
            )
            .map((s) => ({
                amountPaid: s.amountPaid as number,
                currency: s.currency as string,
                isPaid: s.isPaid as boolean,
                startDate: (s.startDate as Date | null) ?? null,
                endDate: (s.endDate as Date | null) ?? null,
                refundedAmount: 0,
            })),
        [],
        [],
    ).mrr

describe('buildBerkutDemoPlan', () => {
    const plan = build()
    const students = plan.members.filter((m) => m.role === 'user')
    const children = new Set(plan.guardianships.map((g) => g.dependentId))

    it('is deterministic for the same day', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(plan))
    })

    it('is a grappling club at its own key: one hall, one direction, four groups', () => {
        expect(plan.workspace).toMatchObject({ key: BERKUT_CLUB_KEY, name: 'Беркут', type: 'GRAPPLING', isDemo: true, timezone: TZ, city: 'Томск' })
        expect(plan.joinCode).toBe(BERKUT_JOIN_CODE)
        expect(plan.gyms).toHaveLength(1)
        expect(plan.gyms[0].name).toBe('Спортзал «Олимп»')
        expect(plan.directions).toHaveLength(1)
        expect(plan.groups.map((g) => g.name)).toEqual(['Взрослые · утро', 'Взрослые · вечер', 'Дети 7–10', 'Подростки'])
    })

    it('shares no id, address or phone with ACADEMY and «Ритм»', () => {
        const ids = (p: DemoClubPlan) =>
            new Set([p.workspaceId, ...p.users.map((u) => u.id), ...p.groups.map((g) => g.id), ...p.subscriptions.map((s) => s.id)])
        for (const other of [buildDemoClubPlan({ ...INPUT, now: NOW }), buildRitmDemoPlan({ ...INPUT, now: NOW })]) {
            const otherIds = ids(other)
            expect([...ids(plan)].filter((id) => otherIds.has(id as string))).toEqual([])
            const phones = new Set(other.users.map((u) => u.phone).filter(Boolean))
            expect(plan.users.filter((u) => u.phone && phones.has(u.phone))).toEqual([])
            expect(plan.joinCode).not.toBe(other.joinCode)
        }
        expect(plan.users.every((u) => !u.email || u.email.endsWith('@berkut.demo'))).toBe(true)
        const phones = plan.users.flatMap((u) => (u.phone ? [u.phone] : []))
        expect(new Set(phones).size).toBe(phones.length)
        expect(phones.every((p) => /^\+79003\d{6}$/.test(p))).toBe(true)
    })

    it('has ~90 students, 25 of them children, each with a parent who confirmed the link', () => {
        expect(students.length).toBeGreaterThanOrEqual(85)
        expect(students.length).toBeLessThanOrEqual(95)
        const kids = students.filter((m) => children.has(m.data.userId))
        expect(kids).toHaveLength(25)
        expect(plan.guardianships.every((g) => g.consentAt)).toBe(true)
        expect(plan.consents.filter((c) => c.kind === 'DEPENDENT_DATA')).toHaveLength(25)
        for (const k of kids) expect(plan.users.find((u) => u.id === k.data.userId)).toMatchObject({ email: null, phone: null })
    })

    it('gives the fixed accounts their roles', () => {
        for (const a of BERKUT_ACCOUNTS) {
            const id = plan.accountUserIds[a.key]
            expect(plan.users.find((u) => u.id === id)?.email).toBe(a.email)
        }
        expect(plan.workspace.ownerId).toBe(plan.accountUserIds.owner)
        expect(plan.members.find((m) => m.data.userId === plan.accountUserIds.owner)?.role).toBe('admin')
        expect(plan.members.find((m) => m.data.userId === plan.accountUserIds.coach)?.role).toBe('coach')
        const coachGroups = plan.groupCoaches.filter((c) => c.userId === plan.accountUserIds.coach)
        expect(coachGroups.length).toBeGreaterThan(0)
    })

    it('copies its ladders from the federation standards, with provenance', () => {
        expect(plan.ladders.map((l) => [l.name, l.templateId, l.templateVersion])).toEqual(
            DEMO_ORG_TEMPLATES.map((t) => [t.name, demoOrgTemplateId(t.key), t.version]),
        )
        for (const t of DEMO_ORG_TEMPLATES) {
            const ladder = plan.ladders.find((l) => l.templateId === demoOrgTemplateId(t.key))!
            const levels = plan.levels.filter((lv) => lv.ladderId === ladder.id).sort((a, b) => a.order - b.order)
            expect(levels.map((lv) => [lv.name, lv.templateLevelId, lv.maxStripes])).toEqual(
                t.levels.map((lv, i) => [lv.name, demoOrgTemplateLevelId(t.key, i), t.maxStripes]),
            )
        }
        const adopted = plan.auditEvents.filter((e) => e.action === 'ladder.fromTemplate')
        expect(adopted).toHaveLength(DEMO_ORG_TEMPLATES.length)
        // The live shape (create-ladder-from-template), so the journals label it.
        expect(adopted.map((e) => [e.organizationId, e.workspaceId, e.metadata])).toEqual(
            DEMO_ORG_TEMPLATES.map((t) => [
                DEMO_ORG_ID,
                plan.workspaceId,
                { name: t.name, clubName: 'Беркут', templateId: demoOrgTemplateId(t.key), templateName: t.name, templateVersion: t.version },
            ]),
        )
    })

    it('gives every student a belt on their group\'s ladder, the adults some higher ones', () => {
        const today = localDateInTz(NOW, TZ)
        const ladderOfGroup = new Map(
            plan.groups.map((g) => [g.id, plan.ladders.find((l) => l.name === (/Взрослые/.test(g.name) ? 'Пояса (взрослые)' : 'Пояса (дети)'))!.id]),
        )
        for (const s of students) {
            const own = plan.promotions.filter((p) => p.userId === s.data.userId)
            expect(own.length).toBeGreaterThan(0)
            const group = plan.groupMembers.find((g) => g.userId === s.data.userId)!.groupId
            expect(own.every((p) => p.ladderId === ladderOfGroup.get(group))).toBe(true)
            const last = own.map((p) => (p.awardedAt as Date).getTime()).sort((a, b) => b - a)[0]
            expect(localDateInTz(new Date(last), TZ) < today).toBe(true)
        }
        const levelOrder = new Map(plan.levels.map((l) => [l.id, l.order]))
        const higher = new Set(plan.promotions.filter((p) => (levelOrder.get(p.levelId) ?? 0) > 0).map((p) => p.userId))
        expect(higher.size).toBeGreaterThanOrEqual(15)
        const ids = plan.promotions.map((p) => p.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it(`has ${BERKUT_HISTORY_DAYS} days of visits on schedule, charged to abonements`, () => {
        const today = localDateInTz(NOW, TZ)
        const dates = plan.sessions.map((s) => new Date(s.sessionDate as Date).toISOString().slice(0, 10)).sort()
        expect(Math.round((Date.parse(today) - Date.parse(dates[0])) / DAY)).toBeGreaterThanOrEqual(BERKUT_HISTORY_DAYS - 3)
        expect(dates.at(-1)! < today).toBe(true)
        expect(plan.records.length).toBeGreaterThan(4000)
        expect(plan.records.every((r) => r.usedSubscriptionId)).toBe(true)
        expect(plan.subscriptions.every((s) => (s.classesRemaining ?? 0) >= 0)).toBe(true)
    })

    // The demo federation shows «Регулярный доход в месяц» for «Беркут» (the
    // club opted in, demo-organization.ts): whatever day the demo is reset on,
    // there is a figure to show.
    it('holds paid current abonements on any reset day, so its monthly income is never empty', () => {
        for (const days of [0, 9, 17, 26]) {
            const now = new Date(NOW.getTime() + days * DAY)
            const day = build(now)
            expect(mrrOf(day, now)).toBeGreaterThan(100_000)
        }
    })

    it('mutes only a couple of students', () => {
        const muted = plan.members.filter((m) => m.role === 'user' && m.data.notificationsMuted)
        expect(muted.length).toBeGreaterThanOrEqual(2)
        expect(muted.length).toBeLessThanOrEqual(3)
    })

    it('moves with today: the same people, dates shifted', () => {
        const later = build(new Date(NOW.getTime() + 7 * DAY))
        expect(later.members.length).toBe(plan.members.length)
        expect(later.workspaceId).toBe(plan.workspaceId)
        expect(later.accountUserIds).toEqual(plan.accountUserIds)
    })
})
