import { localDateInTz } from '../../../server/src/features/attendance/attendance-utils'
import { AnalyticsDigestService } from '../../../server/src/domains/analytics/analytics-digest.service'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000
const TZ = 'Asia/Tomsk'
// Monday 2 Nov 2026 09:15 in Tomsk, and the Monday after.
const MONDAY = new Date('2026-11-02T02:15:00.000Z')
const NEXT_MONDAY = new Date('2026-11-09T02:15:00.000Z')

// «Аналитика» against real Postgres: snapshots built by the refresh endpoint,
// every screen scoped to the caller (admin: club, coach: own groups, direction
// manager: their direction), cross-club isolation, and the owners' weekly
// digest going out once per club per week.
describe('club analytics', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
    })

    const http = () => ctx.http()
    const base = (w: string) => `/workspaces/${w}/analytics`

    // One visit to a group: an ad-hoc session plus a present mark.
    const visit = async (w: string, groupId: string, userId: string, by: string, daysAgo: number) => {
        const at = new Date(Date.now() - daysAgo * DAY)
        const session = await ctx.prisma.attendanceSession.create({
            data: {
                workspaceId: w,
                groupId,
                occurrenceKey: `adhoc:${groupId}:${at.toISOString()}:${userId}`,
                title: 'Тренировка',
                startAt: at,
                timezone: TZ,
                createdById: by,
            },
        })
        await ctx.prisma.attendanceRecord.create({
            data: { sessionId: session.id, workspaceId: w, userId, markedById: by, markedAt: at },
        })
    }

    // Club in Tomsk with БЖЖ (coach A) and ММА (coach B, run by manager M):
    // one slipping student in each, with a paid abonement that ran out.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { ownerMembership: false })
        const w = workspace.id
        await ctx.prisma.workspace.update({ where: { id: w }, data: { timezone: TZ } })
        const ownerActor = await signIn(ctx, owner.email)
        const direction = async (name: string) =>
            (
                await http()
                    .post(`/workspaces/${w}/directions`)
                    .set(...ownerActor.auth)
                    .send({ name })
                    .expect(201)
            ).body.id as string
        const bjj = await direction('БЖЖ')
        const mma = await direction('ММА')
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: w, name: 'Манеж', address: 'ул. Тестовая, 1', timezone: TZ },
        })
        const { user: coachA } = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        const { user: coachB } = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        const { user: manager } = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        await http()
            .post(`/workspaces/${w}/direction-managers`)
            .set(...ownerActor.auth)
            .send({ directionId: mma, userId: manager.id })
            .expect(201)

        // Last week's weekday in the club, so the slot had one class.
        const classYmd = localDateInTz(new Date(Date.now() - 7 * DAY), TZ)
        const dow = new Date(`${classYmd}T00:00:00Z`).getUTCDay() || 7
        const group = async (name: string, directionId: string, coachId: string) => {
            const g = await ctx.prisma.group.create({
                data: {
                    workspaceId: w,
                    name,
                    gymId: gym.id,
                    coachId,
                    directionId,
                    coaches: { create: { userId: coachId, role: 'primary' } },
                    slots: { create: { dayOfWeek: dow, startTime: '19:00', durationMin: 90 } },
                },
                include: { slots: true },
            })
            return { id: g.id, slotId: g.slots[0].id }
        }
        const gA = await group('БЖЖ вечер', bjj, coachA.id)
        const gB = await group('ММА вечер', mma, coachB.id)

        const plan = await createPlan(ctx, { workspaceId: w, price: 5000 })
        const student = async (groupId: string, slotId: string, coachId: string) => {
            const { user, member } = await addMember(ctx, { workspaceId: w })
            await ctx.prisma.groupMember.create({ data: { groupId, userId: user.id } })
            for (const d of [120, 90, 60, 45]) await visit(w, groupId, user.id, coachId, d)
            await ctx.prisma.subscription.create({
                data: {
                    workspaceId: w,
                    planId: plan.id,
                    workspaceMemberId: member.id,
                    status: 'EXPIRED',
                    startDate: new Date(Date.now() - 40 * DAY),
                    endDate: new Date(Date.now() - 10 * DAY),
                    amountPaid: 5000,
                    currency: 'RUB',
                    isPaid: true,
                    paidAt: new Date(Date.now() - 40 * DAY),
                    createdAt: new Date(Date.now() - 40 * DAY),
                },
            })
            // Someone came to last week's class (keeps attendance "active").
            const { user: regular } = await addMember(ctx, { workspaceId: w })
            await ctx.prisma.groupMember.create({ data: { groupId, userId: regular.id } })
            const session = await ctx.prisma.attendanceSession.create({
                data: {
                    workspaceId: w,
                    groupId,
                    slotId,
                    sessionDate: new Date(`${classYmd}T00:00:00Z`),
                    occurrenceKey: `slot:${slotId}:${classYmd}`,
                    title: 'Тренировка',
                    startAt: new Date(Date.now() - 7 * DAY),
                    timezone: TZ,
                    createdById: coachId,
                },
            })
            await ctx.prisma.attendanceRecord.create({
                data: { sessionId: session.id, workspaceId: w, userId: regular.id, markedById: coachId },
            })
            return user
        }
        const m1 = await student(gA.id, gA.slotId, coachA.id)
        const m2 = await student(gB.id, gB.slotId, coachB.id)

        await http().post(`${base(w)}/refresh`).set(...ownerActor.auth).expect(201)

        return {
            w,
            owner,
            ownerActor,
            bjj,
            mma,
            gA,
            gB,
            m1,
            m2,
            coachA: await signIn(ctx, coachA.email!),
            coachAId: coachA.id,
            coachBId: coachB.id,
            manager: await signIn(ctx, manager.email!),
        }
    }

    const get = (w: string, path: string, actor: Actor, query = '') =>
        http().get(`${base(w)}/${path}${query}`).set(...actor.auth)

    const churnIds = async (w: string, actor: Actor, query = '') => {
        const res = await get(w, 'churn', actor, query).expect(200)
        return res.body.data.map((m: { userId: string }) => m.userId).sort()
    }

    it('gives the owner the whole club with scores, reasons and money at stake', async () => {
        const c = await setup()
        expect(await churnIds(c.w, c.ownerActor)).toEqual([c.m1.id, c.m2.id].sort())
        const res = await get(c.w, 'churn', c.ownerActor).expect(200)
        const m = res.body.data[0]
        expect(m.score).toBeGreaterThanOrEqual(60)
        expect(m.level).toBe('high')
        // One 5 000 ₽ abonement paid 40 days ago: 2 months → 2 500 ₽/мес.
        expect(m.monthlySpend).toBe(2500)
        expect(m.reasons.map((r: { code: string }) => r.code)).toEqual(
            expect.arrayContaining(['absent', 'expired']),
        )
        expect(m.canContact).toBe(true)
        expect(res.body.summary).toMatchObject({ total: 2, high: 2, moneyAtStake: 5000 })

        const occupancy = await get(c.w, 'occupancy', c.ownerActor).expect(200)
        expect(occupancy.body.slots).toHaveLength(2)
        expect(occupancy.body.slots[0]).toMatchObject({ held: 1, avgAttendance: 1, capacity: 2, fill: 0.5 })

        const cohorts = await get(c.w, 'cohorts', c.ownerActor).expect(200)
        expect(cohorts.body.cohorts.reduce((s: number, x: { size: number }) => s + x.size, 0)).toBe(4)

        const forecast = await get(c.w, 'forecast', c.ownerActor).expect(200)
        expect(forecast.body).toMatchObject({ members: 4, currency: 'RUB' })
        expect(forecast.body.horizons[0]).toMatchObject({ days: 30, potential: 10000 })
    })

    it('narrows the owner to a direction filter', async () => {
        const c = await setup()
        expect(await churnIds(c.w, c.ownerActor, `?directionId=${c.bjj}`)).toEqual([c.m1.id])
    })

    it('shows a coach only their own groups on every screen', async () => {
        const c = await setup()
        expect(await churnIds(c.w, c.coachA)).toEqual([c.m1.id])
        const occupancy = await get(c.w, 'occupancy', c.coachA).expect(200)
        expect(occupancy.body.slots.map((s: { groupId: string }) => s.groupId)).toEqual([c.gA.id])
        const coaches = await get(c.w, 'coaches', c.coachA).expect(200)
        expect(coaches.body.coaches.map((x: { coachId: string }) => x.coachId)).toEqual([c.coachAId])
        const forecast = await get(c.w, 'forecast', c.coachA).expect(200)
        expect(forecast.body.members).toBe(2)
        // Asking for another coach's direction yields nothing, not their data.
        expect(await churnIds(c.w, c.coachA, `?directionId=${c.mma}`)).toEqual([])
    })

    it('shows a direction manager only the groups of their direction', async () => {
        const c = await setup()
        expect(await churnIds(c.w, c.manager)).toEqual([c.m2.id])
        const coaches = await get(c.w, 'coaches', c.manager).expect(200)
        expect(coaches.body.coaches.map((x: { coachId: string }) => x.coachId)).toEqual([c.coachBId])
        const cohorts = await get(c.w, 'cohorts', c.manager).expect(200)
        expect(cohorts.body.cohorts.reduce((s: number, x: { size: number }) => s + x.size, 0)).toBe(2)
    })

    it('refuses plain members everywhere and coaches the refresh', async () => {
        const c = await setup()
        const member = await signIn(ctx, c.m1.email!)
        for (const path of ['churn', 'cohorts', 'occupancy', 'coaches', 'forecast']) {
            await get(c.w, path, member).expect(403)
        }
        await http().post(`${base(c.w)}/refresh`).set(...member.auth).expect(403)
        await http().post(`${base(c.w)}/refresh`).set(...c.coachA.auth).expect(403)
    })

    it('keeps clubs apart: another owner is refused, a foreign filter is a 404', async () => {
        const c = await setup()
        const { workspace: other, owner: otherOwner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        const otherActor = await signIn(ctx, otherOwner.email)
        for (const path of ['churn', 'cohorts', 'occupancy', 'coaches', 'forecast']) {
            await get(c.w, path, otherActor).expect(403)
        }
        await http().post(`${base(c.w)}/refresh`).set(...otherActor.auth).expect(403)

        const foreignGym = await ctx.prisma.gym.create({
            data: { workspaceId: other.id, name: 'Чужой', address: 'ул. Другая, 2' },
        })
        for (const path of ['churn', 'cohorts', 'occupancy', 'coaches', 'forecast']) {
            await get(c.w, path, c.ownerActor, `?gymId=${foreignGym.id}`).expect(404)
        }
        // The other club's own screens are empty: nothing leaks across.
        await http().post(`${base(other.id)}/refresh`).set(...otherActor.auth).expect(201)
        expect(await churnIds(other.id, otherActor)).toEqual([])
    })

    it('sends the owners digest once per club per week, honouring the opt-out', async () => {
        const c = await setup()
        const { user: admin } = await addMember(ctx, { workspaceId: c.w, role: RolesEnum.ADMIN })
        const { user: optedOut } = await addMember(ctx, { workspaceId: c.w, role: RolesEnum.ADMIN })
        await ctx.prisma.notificationPreferences.create({
            data: { userId: optedOut.id, analyticsDigestEnabled: false },
        })
        const digest = ctx.app.get(AnalyticsDigestService)
        const digestRows = () =>
            ctx.prisma.notification.findMany({
                where: { type: 'PUSH', metadata: { path: ['kind'], equals: 'analytics.digest' } },
                select: { userId: true },
            })

        // Not Monday 09:00 in Tomsk: nothing.
        expect(await digest.run(new Date('2026-11-03T02:15:00.000Z'))).toEqual({ workspaces: 0, sent: 0 })

        expect(await digest.run(MONDAY)).toEqual({ workspaces: 1, sent: 2 })
        expect((await digestRows()).map((r) => r.userId).sort()).toEqual([admin.id, c.owner.id].sort())
        const mail = await ctx.mail.waitFor(
            (m) => m.to === c.owner.email && m.subject.includes('аналитика за неделю'),
        )
        expect(mail.html).toContain('Что сделать')

        // The same Monday again (the job runs every hour): nothing new.
        expect(await digest.run(new Date(MONDAY.getTime() + 30 * 60_000))).toEqual({
            workspaces: 0,
            sent: 0,
        })
        expect(await digestRows()).toHaveLength(2)

        // Next week it goes out again.
        expect(await digest.run(NEXT_MONDAY)).toEqual({ workspaces: 1, sent: 2 })
        expect(await digestRows()).toHaveLength(4)
        expect((await digestRows()).some((r) => r.userId === optedOut.id)).toBe(false)
    })
})
