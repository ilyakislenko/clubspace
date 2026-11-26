import { environment } from '../../../server/src/environments/environment'
import {
    DEMO_STUDENT_CUP_DIVISION,
    DEMO_STUDENT_MAT,
    demoDivisionId,
    demoTournamentEventId,
} from '../../../server/src/domains/demo/demo-tournaments'
import { addOrgStaff, createOrganization } from '../organizations/org-fixtures'
import { clearResendCooldown, signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createPlan, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const DEMO_KEY = 'academy-demo'
const DEMO_CODE = '730592'
const OWNER = 'owner@academy.demo'
const STUDENT = 'student@academy.demo'
const PARENT = 'parent@academy.demo'
// The demo federation's administrator (demo-organization.ts), listed with ACADEMY.
const FEDERATION = 'federation@academy.demo'
const FEDERATION_NAME = 'Федерация БЖЖ Томской области'
const DEMO_ORG_KEY = 'tomsk-bjj-federation-demo'
// The tournament secretary (an org coach), listed with ACADEMY too.
const SECRETARY = 'secretary@academy.demo'
const COACH = 'coach@academy.demo'
// Two full generations per test; the acceptance bound (< 30 s each) is
// asserted explicitly below.
jest.setTimeout(180_000)

// The in-person demo kit: «Сбросить демо» rebuilds ONLY the chosen demo club
// (ACADEMY, «Ритм» or «Беркут») and puts the demo federation back, the demo
// accounts sign in with the fixed code only while DEMO_MODE is on, and only a
// platform admin can reset.
describe('demo kit', () => {
    let ctx: TestApp
    const saved = { ...environment.demo }

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        Object.assign(environment.demo, saved)
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        Object.assign(environment.demo, { enabled: true, workspaceKey: DEMO_KEY, code: DEMO_CODE })
    })

    const reset = (actor?: Actor, club?: 'academy' | 'ritm' | 'berkut') => {
        const req = ctx.http().post('/platform/demo-club/reset').query(club ? { club } : {})
        return actor ? req.set(...actor.auth) : req
    }

    // One club's rows.
    const clubCounts = async (workspaceId: string) => {
        const where = { workspaceId }
        return {
            members: await ctx.prisma.workspaceMember.count({ where }),
            groups: await ctx.prisma.group.count({ where }),
            sessions: await ctx.prisma.attendanceSession.count({ where }),
            visits: await ctx.prisma.attendanceRecord.count({ where }),
            subscriptions: await ctx.prisma.subscription.count({ where }),
            freezes: await ctx.prisma.subscriptionFreeze.count({ where }),
            promotions: await ctx.prisma.rankPromotion.count({ where }),
            announcements: await ctx.prisma.announcement.count({ where }),
            discounts: await ctx.prisma.discount.count({ where }),
        }
    }
    const demoCounts = async (workspaceId: string) => ({
        ...(await clubCounts(workspaceId)),
        demoUsers: await ctx.prisma.user.count({ where: { isDemo: true } }),
    })

    // A real club with people, a plan and a class: must come out untouched.
    const otherClub = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Настоящий клуб' })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await createPlan(ctx, { workspaceId: workspace.id })
        await createGroupWithSlot(ctx, { workspaceId: workspace.id, coachUserId: owner.id, dayOfWeek: 2 })
        return { workspace, owner, member: user }
    }
    const otherCounts = async (workspaceId: string) => ({
        members: await ctx.prisma.workspaceMember.count({ where: { workspaceId } }),
        plans: await ctx.prisma.plan.count({ where: { workspaceId } }),
        groups: await ctx.prisma.group.count({ where: { workspaceId } }),
        users: await ctx.prisma.user.count({ where: { isDemo: false } }),
    })

    const fixedCodeSignIn = async (email: string, code = DEMO_CODE) => {
        await clearResendCooldown(ctx, email)
        await ctx.http().post('/send-auth-code').send({ email }).expect(201)
        return ctx.http().post('/sign-in').send({ email, code })
    }

    it('lets only a platform admin reset the demo', async () => {
        const { owner } = await otherClub()
        const clubOwner = await signIn(ctx, owner.email as string)
        expect((await reset()).status).toBe(401)
        expect((await reset(clubOwner)).status).toBe(403)
        expect((await ctx.http().get('/platform/demo-club').set(...clubOwner.auth)).status).toBe(403)
        expect(await ctx.prisma.workspace.count({ where: { key: DEMO_KEY } })).toBe(0)
    })

    it('refuses to reset with demo mode off, and never touches a real club holding the key', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        environment.demo.enabled = false
        expect((await reset(admin)).status).toBe(403)
        expect(await ctx.prisma.workspace.count({ where: { key: DEMO_KEY } })).toBe(0)

        environment.demo.enabled = true
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY, name: 'Чужой клуб' })
        expect((await reset(admin)).status).toBe(400)
        expect(await ctx.prisma.workspace.findUnique({ where: { id: workspace.id } })).not.toBeNull()
    })

    it('rebuilds only the demo club, the same twice in a row, in under 30 s', async () => {
        const other = await otherClub()
        const before = await otherCounts(other.workspace.id)
        const admin = await signIn(ctx, PLATFORM_OWNER)

        const started = Date.now()
        const first = await reset(admin)
        expect(first.status).toBe(201)
        expect(Date.now() - started).toBeLessThan(30_000)
        const workspaceId = first.body.workspaceId as string
        const once = await demoCounts(workspaceId)
        expect(once.members).toBeGreaterThan(120)
        expect(once.groups).toBeGreaterThanOrEqual(10)
        expect(once.visits).toBeGreaterThan(2000)
        expect(once.freezes).toBe(3)

        const second = await reset(admin)
        expect(second.status).toBe(201)
        expect(second.body.workspaceId).toBe(workspaceId)
        expect(await demoCounts(workspaceId)).toEqual(once)
        expect(await otherCounts(other.workspace.id)).toEqual(before)
        expect(await ctx.prisma.user.findUnique({ where: { id: other.member.id } })).not.toBeNull()

        const card = await ctx.http().get('/platform/demo-club').set(...admin.auth).expect(200)
        expect(card.body).toMatchObject({
            enabled: true,
            workspaceKey: DEMO_KEY,
            loginCode: DEMO_CODE,
            workspace: { id: workspaceId, joinCode: 'ACADEMY7' },
        })
        expect(card.body.lastResetAt).not.toBeNull()
        expect(card.body.accounts.map((a: { email: string | null }) => a.email)).toEqual(
            expect.arrayContaining([OWNER, STUDENT, PARENT, null]),
        )

        // The product computes the demo's screens from the generated rows, and
        // they read as a healthy club: about one student in ten at risk, a few
        // renewals and expiring accesses, a handful of unpaid abonements and six
        // months of revenue.
        const owner = await fixedCodeSignIn(OWNER)
        expect(owner.status).toBe(201)
        const auth: [string, string] = ['Authorization', `Bearer ${owner.body.accessToken}`]
        const stats = await ctx.http().get(`/workspaces/${workspaceId}/stats`).set(...auth).expect(200)
        const students = stats.body.counts.students as number
        const share = (n: number) => n / students
        const atRisk = await ctx
            .http()
            .get(`/workspaces/${workspaceId}/at-risk-members?perPage=200`)
            .set(...auth)
            .expect(200)
        expect(share(atRisk.body.summary.total)).toBeGreaterThan(0.06)
        expect(share(atRisk.body.summary.total)).toBeLessThan(0.14)
        // «Кому позвонить» has someone to call for every entry, and people
        // worth a call with money at stake.
        expect(
            atRisk.body.data.every(
                (m: { phone: string | null; guardians: { phone: string | null }[] }) =>
                    m.phone || m.guardians.some((g) => g.phone),
            ),
        ).toBe(true)
        expect(
            atRisk.body.data.filter(
                (e: { level: string | null; monthlySpend: number | null }) =>
                    e.level === 'high' && (e.monthlySpend ?? 0) > 0,
            ).length,
        ).toBeGreaterThanOrEqual(3)
        const renewals = await ctx.http().get(`/workspaces/${workspaceId}/renewal-candidates`).set(...auth).expect(200)
        expect(share(renewals.body.total)).toBeGreaterThan(0.05)
        expect(share(renewals.body.total)).toBeLessThan(0.2)
        // The dashboard tile is the list's total.
        expect(stats.body.retention.renewalsDue).toBe(renewals.body.total)
        expect(share(stats.body.retention.notAttended30d)).toBeLessThan(0.1)
        expect(stats.body.revenue.awaitingPayment.students).toBeGreaterThanOrEqual(2)
        expect(stats.body.revenue.awaitingPayment.students).toBeLessThanOrEqual(5)
        // Sales run through the whole history: both the last 30 days and the
        // 30 before them (the dashboard's trend) have revenue.
        expect(stats.body.revenue.revenue30d).toBeGreaterThan(0)
        expect(stats.body.revenue.revenuePrev30d).toBeGreaterThan(0)
        // «Скидки» (docs/design/2026-11-15-discounts.md §9): the three demo
        // discounts with their uses, and «Кто давал скидки» with the head
        // coach's cash part-payment and the admin's one-off.
        const discounts = await ctx.http().get(`/workspaces/${workspaceId}/discounts`).set(...auth).expect(200)
        const byName = new Map(
            (discounts.body.data as { name: string; code: string | null; isFamily: boolean; uses: number }[]).map(
                (d) => [d.name, d],
            ),
        )
        expect([...byName.keys()].sort()).toEqual(['Продление −5%', 'Семейная', 'Студенческая'])
        expect(byName.get('Семейная')).toMatchObject({ isFamily: true })
        expect(byName.get('Семейная')!.uses).toBeGreaterThan(0)
        expect(byName.get('Студенческая')!.uses).toBeGreaterThan(0)
        // ПРОДЛИ5: a few renewals with the promo code, once per member.
        expect(byName.get('Продление −5%')).toMatchObject({ code: 'ПРОДЛИ5' })
        expect(byName.get('Продление −5%')!.uses).toBeGreaterThan(0)
        const coachId = (await ctx.prisma.user.findFirstOrThrow({ where: { email: 'coach@academy.demo' } })).id
        const staff = discounts.body.byStaff as { userId: string; oneOff: { count: number; amount: number } }[]
        expect(staff.find((s) => s.userId === coachId)?.oneOff).toEqual({ count: 1, amount: 1000 })
        const discounted = await ctx
            .http()
            .get(`/workspaces/${workspaceId}/payment-journal`)
            .query({ discounted: 'true', pricedById: coachId })
            .set(...auth)
            .expect(200)
        expect(discounted.body.data).toEqual([
            expect.objectContaining({ oneOffDiscount: 1000, pricedBy: expect.objectContaining({ userId: coachId }) }),
        ])
        const board = await ctx.http().get(`/workspaces/${workspaceId}/leaderboard`).set(...auth).expect(200)
        expect(board.body.entries.length).toBeGreaterThan(10)
        const readiness = await ctx.http().get(`/workspaces/${workspaceId}/rank-readiness`).set(...auth).expect(200)
        expect(readiness.body.data.length).toBeGreaterThan(0)

        // «Аналитика» is rebuilt by the reset and has a story on every screen:
        // weak slots and one over its roster, a coach whose people stay, a
        // falling cohort curve, and trials both converted and not.
        const analytics = (path: string) =>
            ctx.http().get(`/workspaces/${workspaceId}/analytics/${path}`).set(...auth).expect(200)
        const occupancy = await analytics('occupancy')
        expect(occupancy.body.weakest.length).toBeGreaterThanOrEqual(1)
        expect(
            occupancy.body.suggestions.some((s: { kind: string }) => s.kind === 'add_class'),
        ).toBe(true)
        const coaches = await analytics('coaches')
        const rates = (coaches.body.coaches as { retention: { rate: number | null } }[])
            .flatMap((c) => (c.retention.rate === null ? [] : [c.retention.rate]))
            .sort((a, b) => a - b)
        const mid = Math.floor(rates.length / 2)
        const median = rates.length % 2 === 1 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
        expect(rates[rates.length - 1] - median).toBeGreaterThanOrEqual(0.15)
        const cohorts = await analytics('cohorts')
        expect(
            cohorts.body.cohorts.filter(
                (c: { cells: { offset: number; rate: number | null }[] }) =>
                    c.cells.find((x) => x.offset === 1)?.rate != null,
            ).length,
        ).toBeGreaterThanOrEqual(3)
        const average = cohorts.body.average as { offset: number; rate: number }[]
        expect(average.find((a) => a.offset === 3)!.rate).toBeLessThan(average.find((a) => a.offset === 1)!.rate)
        const forecast = await analytics('forecast')
        expect(forecast.body.trial.converted).toBeGreaterThan(0)
        expect(forecast.body.trial.converted).toBeLessThan(forecast.body.trial.trials)
    })

    it('gives the staff of both demo clubs something on every «Сегодня» row and classes today', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const academy = (await reset(admin, 'academy').expect(201)).body.workspaceId as string
        const ritm = (await reset(admin, 'ritm').expect(201)).body.workspaceId as string
        // As the platform admin: club-wide, like the owner, without a second
        // fixed-code sign-in right after the first.
        const check = async (workspaceId: string) => {
            const get = (path: string) => ctx.http().get(`/workspaces/${workspaceId}${path}`).set(...admin.auth).expect(200)
            // «Заявки»: a join, a freeze, a personal training and a video review wait.
            const requests = await get('/requests')
            for (const kind of ['join', 'freeze', 'personal', 'video']) {
                expect(requests.body.counts[kind]).toBeGreaterThan(0)
            }
            const stats = await get('/stats')
            // Course placeholders are not «Видео в обработке или с ошибкой».
            expect(stats.body.counts.videos - stats.body.counts.videosReady).toBe(0)
            expect(stats.body.retention.renewalsDue).toBeGreaterThan(0)
            expect(stats.body.revenue.awaitingPayment.students).toBeGreaterThan(0)
            const atRisk = await get('/at-risk-members?perPage=1')
            expect(atRisk.body.summary.total).toBeGreaterThan(0)
            // Classes today in the club's own calendar day, whatever the weekday.
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tomsk' }).format(new Date())
            const day = await get(`/schedule?from=${today}&to=${today}`)
            expect(
                (day.body.sessions as { occurrenceId: string; cancelled: boolean }[]).filter(
                    (s) => s.occurrenceId.endsWith(`:${today}`) && !s.cancelled,
                ).length,
            ).toBeGreaterThan(0)
            // The journal (30 days): a refund, and who marked every sale.
            const journal = await get('/payment-journal?perPage=200')
            expect(journal.body.totals[0].refunded).toBeGreaterThan(0)
            const rows = journal.body.data as { kind: string; markedBy: unknown }[]
            expect(rows.filter((r) => r.kind === 'payment').every((r) => r.markedBy !== null)).toBe(true)
            const discounts = await get('/discounts')
            expect((discounts.body.data as { uses: number }[]).every((d) => d.uses > 0)).toBe(true)
        }
        await check(academy)
        await check(ritm)
    })

    // Three demo clubs (docs/demo.md): each resets on its own and leaves the
    // other two as they are; the demo federation over ACADEMY and «Беркут» is
    // put back as scripted after every reset.
    it('resets each of the three demo clubs on its own and keeps the federation over ACADEMY and Беркут', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const ids: Record<'academy' | 'ritm' | 'berkut', string> = { academy: '', ritm: '', berkut: '' }
        for (const club of ['academy', 'ritm', 'berkut'] as const) {
            const started = Date.now()
            const res = await reset(admin, club).expect(201)
            expect(Date.now() - started).toBeLessThan(30_000)
            expect(res.body.club).toBe(club)
            ids[club] = res.body.workspaceId as string
        }
        expect(new Set(Object.values(ids)).size).toBe(3)

        const cards = {
            ritm: await ctx.http().get('/platform/demo-club').query({ club: 'ritm' }).set(...admin.auth).expect(200),
            berkut: await ctx.http().get('/platform/demo-club').query({ club: 'berkut' }).set(...admin.auth).expect(200),
        }
        expect(cards.ritm.body).toMatchObject({ club: 'ritm', workspace: { id: ids.ritm, joinCode: 'RTMDANCE' } })
        expect(cards.berkut.body).toMatchObject({
            club: 'berkut',
            name: 'Беркут',
            workspaceKey: 'berkut-demo',
            workspace: { id: ids.berkut, joinCode: 'BERKUT24' },
        })
        expect(cards.berkut.body.accounts.map((a: { email: string | null }) => a.email)).toEqual([
            'owner@berkut.demo',
            'coach@berkut.demo',
        ])
        const berkut = await clubCounts(ids.berkut)
        expect(berkut.members).toBeGreaterThan(80)
        expect(berkut.groups).toBe(4)

        const federation = async () => {
            const org = await ctx.prisma.organization.findUniqueOrThrow({
                where: { key: DEMO_ORG_KEY },
                select: { id: true, isDemo: true, name: true },
            })
            const links = await ctx.prisma.organizationClub.findMany({
                where: { organizationId: org.id },
                select: { workspaceId: true, status: true, shareMrr: true },
                orderBy: { workspaceId: 'asc' },
            })
            const registrations = await ctx.prisma.organizationEventRegistration.groupBy({
                by: ['workspaceId'],
                where: { event: { organizationId: org.id } },
                _count: { _all: true },
                orderBy: { workspaceId: 'asc' },
            })
            return { org, links, registrations }
        }
        const scripted = await federation()
        expect(scripted.org).toMatchObject({ isDemo: true, name: FEDERATION_NAME })
        expect(scripted.links).toEqual(
            expect.arrayContaining([
                { workspaceId: ids.academy, status: 'ACTIVE', shareMrr: false },
                { workspaceId: ids.berkut, status: 'ACTIVE', shareMrr: true },
            ]),
        )
        expect(scripted.links).toHaveLength(2)
        // ACADEMY's adults' and children's BJJ ladders follow the standards
        // (the registry shows only linked ladders).
        const linked = await ctx.prisma.rankLadder.findMany({
            where: { workspaceId: ids.academy, templateId: { not: null } },
            select: { name: true, templateVersion: true, levels: { select: { templateLevelId: true } } },
            orderBy: { name: 'asc' },
        })
        expect(linked.map((l) => [l.name, l.templateVersion])).toEqual([
            ['Пояса БЖЖ', 1],
            ['Пояса БЖЖ — дети', 1],
        ])
        expect(linked.every((l) => l.levels.length > 0 && l.levels.every((v) => v.templateLevelId !== null))).toBe(true)
        expect(scripted.registrations.map((r) => r.workspaceId).sort()).toEqual([ids.academy, ids.berkut].sort())

        // Each reset touches its own club only; the federation reads the same.
        const before = { academy: await clubCounts(ids.academy), ritm: await clubCounts(ids.ritm) }
        await reset(admin, 'berkut').expect(201)
        expect(await clubCounts(ids.berkut)).toEqual(berkut)
        expect({ academy: await clubCounts(ids.academy), ritm: await clubCounts(ids.ritm) }).toEqual(before)
        await reset(admin, 'ritm').expect(201)
        expect(await clubCounts(ids.academy)).toEqual(before.academy)
        expect(await clubCounts(ids.berkut)).toEqual(berkut)
        expect(await federation()).toEqual(scripted)

        // The federation account sees both clubs; ACADEMY keeps its money to
        // itself, Беркут opened its monthly income.
        const fed = await fixedCodeSignIn(FEDERATION)
        expect(fed.status).toBe(201)
        const clubs = await ctx
            .http()
            .get(`/orgs/${scripted.org.id}/clubs`)
            .set('Authorization', `Bearer ${fed.body.accessToken}`)
            .expect(200)
        const rowOf = (workspaceId: string) =>
            (clubs.body.data as { club: { workspaceId: string }; metrics: { mrr: unknown } | null }[]).find(
                (r) => r.club.workspaceId === workspaceId,
            )
        expect(rowOf(ids.academy)?.metrics).toMatchObject({ mrr: null })
        expect(rowOf(ids.berkut)?.metrics?.mrr).not.toBeNull()
    }, 300_000)

    // The federation's tournaments (docs/demo.md «Турниры»): running on 3
    // mats, the 1st stage published, the open one taking entries — through
    // the same routes the phones and the console use.
    it('puts the federation\'s three tournaments back after a reset, each person seeing their own', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const academy = (await reset(admin, 'academy').expect(201)).body.workspaceId as string
        await reset(admin, 'berkut').expect(201)
        const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { key: DEMO_ORG_KEY }, select: { id: true } })
        const tournaments = await ctx.prisma.tournament.findMany({
            where: { organizationId: org.id },
            select: { id: true, status: true, matCount: true, event: { select: { title: true } } },
            orderBy: { createdAt: 'asc' },
        })
        expect(tournaments.map((t) => [t.event.title, t.status])).toEqual([
            ['Кубок федерации, 1-й этап', 'FINISHED'],
            ['Кубок федерации, 2-й этап', 'RUNNING'],
            ['Открытый турнир Томской области', 'SETUP'],
        ])
        const cupEvent = demoTournamentEventId('cup')
        const bearer = (r: { body: { accessToken: string } }) => ['Authorization', `Bearer ${r.body.accessToken}`] as const

        // student@: his division on mat 2, next but one; himself highlighted
        // in the bracket, nobody's weight or birth year in it.
        const student = await fixedCodeSignIn(STUDENT)
        const cup = await ctx.http().get(`/workspaces/${academy}/org-events/${cupEvent}/tournament`).set(...bearer(student)).expect(200)
        expect(cup.body).toMatchObject({ status: 'RUNNING', matCount: 3 })
        expect(cup.body.myEntry).toMatchObject({
            status: 'CONFIRMED',
            divisionId: demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION),
            bracketAvailable: true,
            nextMatch: { mat: DEMO_STUDENT_MAT, ahead: 1 },
        })
        expect(cup.body.myEntry.nextMatch.opponent).not.toBeNull()
        const events = await ctx.http().get(`/workspaces/${academy}/org-events`).set(...bearer(student)).expect(200)
        expect(events.body.data.find((e: { id: string }) => e.id === cupEvent)).toMatchObject({
            tournament: { status: 'RUNNING' },
            myEntryState: { state: 'CONFIRMED', mat: DEMO_STUDENT_MAT, ahead: 1 },
        })
        const bracket = await ctx
            .http()
            .get(`/workspaces/${academy}/org-events/${cupEvent}/tournament/divisions/${demoDivisionId('cup', DEMO_STUDENT_CUP_DIVISION)}/bracket`)
            .set(...bearer(student))
            .expect(200)
        const sides = (bracket.body.matches as { entryA: { isMe: boolean } | null; entryB: { isMe: boolean } | null }[]).flatMap((m) => [m.entryA, m.entryB])
        expect(sides.some((p) => p?.isMe)).toBe(true)
        expect(JSON.stringify(bracket.body)).not.toMatch(/eight|birthYear|userId/)
        // The 1st stage's 3rd place is in «Мои пояса».
        const mine = await ctx.http().get(`/workspaces/${academy}/me/organizations`).set(...bearer(student)).expect(200)
        expect(mine.body.data[0].podiums).toEqual([expect.objectContaining({ tournamentTitle: 'Кубок федерации, 1-й этап', place: 3 })])

        // parent@ acting for Миша: his entry at the running cup, his 2nd
        // place at the 1st stage.
        const parent = await fixedCodeSignIn(PARENT)
        const misha = { id: (await ctx.prisma.guardianship.findFirstOrThrow({ where: { guardianId: parent.body.userId, dependent: { firstname: 'Миша' } }, select: { dependentId: true } })).dependentId }
        const forMisha = await ctx
            .http()
            .get(`/workspaces/${academy}/org-events/${cupEvent}/tournament`)
            .set(...bearer(parent))
            .set('X-Act-As', misha.id)
            .expect(200)
        expect(forMisha.body.myEntry).toMatchObject({ status: 'CONFIRMED', userId: misha.id })
        const mishaOrgs = await ctx.http().get(`/workspaces/${academy}/me/organizations`).set(...bearer(parent)).set('X-Act-As', misha.id).expect(200)
        expect(mishaOrgs.body.data[0].podiums).toEqual([expect.objectContaining({ place: 2 })])

        // coach@: three entries wait for him at the open tournament.
        const coach = await fixedCodeSignIn(COACH)
        const openEvent = (await ctx.prisma.tournament.findFirstOrThrow({ where: { organizationId: org.id, status: 'SETUP' }, select: { eventId: true } })).eventId
        const athletes = await ctx
            .http()
            .get(`/workspaces/${academy}/org-events/${openEvent}/tournament/athletes`)
            .set(...bearer(coach))
            .expect(200)
        expect(athletes.body.toConfirmCount).toBe(3)

        // The tournament secretary signs in with the code and is an org
        // coach of the demo federation.
        const secretary = await fixedCodeSignIn(SECRETARY)
        expect(secretary.status).toBe(201)
        const orgs = await ctx.http().get('/orgs/mine').set(...bearer(secretary)).expect(200)
        expect(orgs.body.data).toEqual([expect.objectContaining({ name: FEDERATION_NAME, role: 'ORG_COACH' })])

        // Another reset puts the same tournaments back, nothing doubled.
        const counts = async () => ({
            entries: await ctx.prisma.tournamentEntry.count({ where: { tournament: { organizationId: org.id } } }),
            matches: await ctx.prisma.tournamentMatch.count({ where: { division: { tournament: { organizationId: org.id } } } }),
        })
        const first = await counts()
        await reset(admin, 'ritm').expect(201)
        expect(await counts()).toEqual(first)
    }, 300_000)

    it('signs demo accounts in with the fixed code only in demo mode', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const { body } = await reset(admin).expect(201)
        const workspaceId = body.workspaceId as string

        // No mail for a demo account: the code is fixed.
        const student = await fixedCodeSignIn(STUDENT)
        expect(student.status).toBe(201)
        expect(ctx.mail.sent.some((m) => JSON.stringify(m).includes(STUDENT))).toBe(false)
        const clubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set('Authorization', `Bearer ${student.body.accessToken}`)
            .send({})
            .expect(201)
        expect(clubs.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toEqual([workspaceId])
        await ctx
            .http()
            .get(`/workspaces/${workspaceId}/me/subscription`)
            .set('Authorization', `Bearer ${student.body.accessToken}`)
            .expect(200)

        // The parent opens a child through «Я / ребёнок».
        const parent = await fixedCodeSignIn(PARENT)
        expect(parent.status).toBe(201)
        const child = await ctx.prisma.guardianship.findFirstOrThrow({
            where: { guardianId: parent.body.userId, consentAt: { not: null } },
        })
        const childClubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set('Authorization', `Bearer ${parent.body.accessToken}`)
            .set('X-Act-As', child.dependentId)
            .send({})
            .expect(201)
        expect(childClubs.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toEqual([workspaceId])

        // A wrong code is a wrong code.
        expect((await fixedCodeSignIn(OWNER, '918273')).status).not.toBe(201)

        // A normal account never opens with the demo code.
        await createUser(ctx, { email: 'someone@example.com' })
        expect((await fixedCodeSignIn('someone@example.com')).status).not.toBe(201)

        // A demo account that also belongs to a real club is refused.
        const other = await otherClub()
        const ownerUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER } })
        const extra = await addMember(ctx, { workspaceId: other.workspace.id, userId: ownerUser.id })
        expect((await fixedCodeSignIn(OWNER)).status).not.toBe(201)
        await ctx.prisma.workspaceMember.delete({ where: { id: extra.member.id } })

        // Demo mode off: the fixed code opens nothing.
        environment.demo.enabled = false
        expect((await fixedCodeSignIn(OWNER)).status).not.toBe(201)
        environment.demo.enabled = true
        expect((await fixedCodeSignIn(OWNER)).status).toBe(201)

        // The demo federation's administrator opens with the code too and
        // lands on its federation.
        const fed = await fixedCodeSignIn(FEDERATION)
        expect(fed.status).toBe(201)
        expect(ctx.mail.sent.some((m) => JSON.stringify(m).includes(FEDERATION))).toBe(false)
        const mine = await ctx
            .http()
            .get('/orgs/mine')
            .set('Authorization', `Bearer ${fed.body.accessToken}`)
            .expect(200)
        expect(mine.body.data).toEqual([expect.objectContaining({ name: FEDERATION_NAME, role: 'ORG_ADMIN' })])
        // …but not once it is on the staff of a real federation,
        const fedUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: FEDERATION } })
        const real = await createOrganization(ctx, { name: 'Настоящая федерация' })
        const staff = await addOrgStaff(ctx, { organizationId: real.id, userId: fedUser.id })
        expect((await fixedCodeSignIn(FEDERATION)).status).not.toBe(201)
        await ctx.prisma.organizationMember.delete({ where: { id: staff.id } })
        expect((await fixedCodeSignIn(FEDERATION)).status).toBe(201)
        // …nor when its federation is not a demo one.
        await ctx.prisma.organization.update({ where: { key: DEMO_ORG_KEY }, data: { isDemo: false } })
        expect((await fixedCodeSignIn(FEDERATION)).status).not.toBe(201)
        await ctx.prisma.organization.update({ where: { key: DEMO_ORG_KEY }, data: { isDemo: true } })
    })

    // One demo account is opened on the presenter's tablet and phone within
    // the same minute; nothing is mailed, so there is no resend cooldown.
    it('lets two devices ask for one demo account\'s code back to back', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        await reset(admin).expect(201)
        await ctx.http().post('/send-auth-code').send({ email: STUDENT }).expect(201)
        await ctx.http().post('/send-auth-code').send({ email: STUDENT }).expect(201)
        await ctx.http().post('/sign-in').send({ email: STUDENT, code: DEMO_CODE }).expect(201)
        // Signed out and back in at once: the code is asked for again.
        await ctx.http().post('/send-auth-code').send({ email: STUDENT }).expect(201)
        await ctx.http().post('/sign-in').send({ email: STUDENT, code: DEMO_CODE }).expect(201)
    })

    it('keeps the demo accounts signed in across a reset', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        await reset(admin).expect(201)
        const student = await fixedCodeSignIn(STUDENT)
        await reset(admin).expect(201)
        const refreshed = await ctx
            .http()
            .post('/refresh-token')
            .send({ refreshToken: student.body.refreshToken })
        expect(refreshed.status).toBe(201)

        environment.demo.enabled = false
        const blocked = await ctx
            .http()
            .post('/refresh-token')
            .send({ refreshToken: refreshed.body.refreshToken })
        expect(blocked.status).not.toBe(201)
    })
})
