import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Руководитель направления: a coach assigned to run БЖЖ writes everything of
// БЖЖ — groups and schedule, ladders, gradings, promotions, achievements,
// announcements, events, tariffs — and nothing of ММА, nothing club-wide, no
// club settings. Admins, head coaches and plain coaches keep their rights.
describe('direction managers', () => {
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

    const ws = (workspaceId: string) => `/workspaces/${workspaceId}`
    const http = () => ctx.http()

    const memberActor = async (workspaceId: string, role: RolesEnum) => {
        const { user } = await addMember(ctx, { workspaceId, role })
        return { user, actor: await signIn(ctx, user.email!) }
    }

    const assign = (workspaceId: string, actor: Actor, directionId: string, userId: string) =>
        http()
            .post(`${ws(workspaceId)}/direction-managers`)
            .set(...actor.auth)
            .send({ directionId, userId })

    // Club with БЖЖ and ММА: a group, ladder (+ level) of each and a club-wide
    // one; `manager` (coach) runs БЖЖ, `coach` is a plain coach.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const w = workspace.id
        const ownerActor = await signIn(ctx, owner.email)
        const direction = async (name: string) =>
            (
                await http()
                    .post(`${ws(w)}/directions`)
                    .set(...ownerActor.auth)
                    .send({ name })
                    .expect(201)
            ).body.id as string
        const bjj = await direction('БЖЖ')
        const mma = await direction('ММА')
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: w, name: 'Манеж', address: 'ул. Тестовая, 1' },
        })
        const group = (name: string, directionId: string | null) =>
            ctx.prisma.group.create({
                data: {
                    workspaceId: w,
                    name,
                    gymId: gym.id,
                    coachId: owner.id,
                    directionId,
                    coaches: { create: { userId: owner.id, role: 'primary' } },
                },
            })
        const ladder = async (name: string, directionId: string | null) => {
            const l = await ctx.prisma.rankLadder.create({
                data: {
                    workspaceId: w,
                    name,
                    directionId,
                    levels: {
                        create: [
                            { name: 'Белый', order: 0 },
                            { name: 'Синий', order: 1 },
                        ],
                    },
                },
                include: { levels: { orderBy: { order: 'asc' } } },
            })
            return { id: l.id, levelIds: l.levels.map((x) => x.id) }
        }
        const manager = await memberActor(w, RolesEnum.COACH)
        const coach = await memberActor(w, RolesEnum.COACH)
        const { user: student } = await addMember(ctx, { workspaceId: w })
        await assign(w, ownerActor, bjj, manager.user.id).expect(201)
        return {
            w,
            owner,
            ownerActor,
            bjj,
            mma,
            gym,
            groups: {
                bjj: await group('БЖЖ взрослые', bjj),
                mma: await group('ММА вечер', mma),
                club: await group('ОФП', null),
            },
            ladders: {
                bjj: await ladder('Пояса БЖЖ', bjj),
                mma: await ladder('ММА', mma),
                club: await ladder('Общая', null),
            },
            manager,
            coach,
            student,
        }
    }
    type Club = Awaited<ReturnType<typeof setup>>

    // Every direction-owned write, aimed at one direction (null = club-wide).
    // Returns status per route so a matrix failure names the route.
    const writes = async (c: Club, actor: Actor, target: 'bjj' | 'mma' | 'club') => {
        const directionId = target === 'club' ? null : c[target]
        const group = c.groups[target]
        const ladder = c.ladders[target]
        const base = ws(c.w)
        const s = async (req: Promise<{ status: number }>) => (await req).status
        return {
            createGroup: await s(
                http()
                    .post(`${base}/groups`)
                    .set(...actor.auth)
                    .send({ name: 'Новая', gymId: c.gym.id, coachId: c.coach.user.id, directionId }),
            ),
            editGroup: await s(
                http()
                    .patch(`${base}/groups/${group.id}`)
                    .set(...actor.auth)
                    .send({ name: `${group.name} (утро)` }),
            ),
            scheduleSlot: await s(
                http()
                    .post(`${base}/groups/${group.id}/schedule/slots`)
                    .set(...actor.auth)
                    .send({ dayOfWeek: 2, startTime: '19:00', durationMin: 90 }),
            ),
            createLevel: await s(
                http()
                    .post(`${base}/rank-ladders/${ladder.id}/levels`)
                    .set(...actor.auth)
                    .send({ name: 'Фиолетовый', order: 2 }),
            ),
            editLadder: await s(
                http()
                    .patch(`${base}/rank-ladders/${ladder.id}`)
                    .set(...actor.auth)
                    .send({ order: 3 }),
            ),
            createGrading: await s(
                http()
                    .post(`${base}/rank-gradings`)
                    .set(...actor.auth)
                    .send({ ladderId: ladder.id, date: '2026-12-15' }),
            ),
            promote: await s(
                http()
                    .post(`${base}/members/${c.student.id}/rank`)
                    .set(...actor.auth)
                    .send({ ladderId: ladder.id, levelId: ladder.levelIds[1] }),
            ),
            achievement: await s(
                http()
                    .post(`${base}/achievements`)
                    .set(...actor.auth)
                    .send({ name: '10 тренировок', threshold: 10, directionId }),
            ),
            announcement: await s(
                http()
                    .post(`${base}/announcements`)
                    .set(...actor.auth)
                    .send({ title: 'Сборы', body: 'В субботу', directionId, publish: true }),
            ),
            event: await s(
                http()
                    .post(`${base}/events`)
                    .set(...actor.auth)
                    .send({
                        title: 'Семинар',
                        startAt: '2026-12-20T12:00',
                        endAt: '2026-12-20T14:00',
                        timezone: 'Europe/Moscow',
                        directionId,
                    }),
            ),
            tariff: await s(
                http()
                    .post(`${base}/plans`)
                    .set(...actor.auth)
                    .send({
                        name: '12 занятий',
                        price: 500000,
                        currency: 'RUB',
                        durationDays: 30,
                        classCount: 12,
                        directionId,
                    }),
            ),
        }
    }

    const expectAll = (results: Record<string, number>, ok: boolean) => {
        for (const [route, status] of Object.entries(results)) {
            expect({ route, ok: status >= 200 && status < 300 }).toEqual({ route, ok })
            if (!ok) expect({ route, status }).toEqual({ route, status: 403 })
        }
    }

    describe('assigning', () => {
        it('the owner assigns a coach, audited; the coach sees it in their membership', async () => {
            const c = await setup()
            const list = await http()
                .get(`${ws(c.w)}/direction-managers`)
                .set(...c.ownerActor.auth)
                .expect(200)
            expect(list.body.data).toEqual([
                expect.objectContaining({ directionId: c.bjj, userId: c.manager.user.id }),
            ])
            const audit = await ctx.prisma.auditEvent.findFirst({
                where: { workspaceId: c.w, action: 'direction.managerAssign' },
            })
            expect(audit).toMatchObject({ targetId: c.bjj, actorId: c.owner.id })
            const me = await http()
                .get(`${ws(c.w)}/members/me`)
                .set(...c.manager.actor.auth)
            expect(me.status).toBe(200)
            expect(me.body.managedDirectionIds).toEqual([c.bjj])
        })

        it('a head coach may assign; a coach or a manager may not; only coaches can be assigned', async () => {
            const c = await setup()
            const head = await memberActor(c.w, RolesEnum.HEAD_COACH)
            await assign(c.w, head.actor, c.mma, c.coach.user.id).expect(201)
            await assign(c.w, c.coach.actor, c.bjj, c.coach.user.id).expect(403)
            await assign(c.w, c.manager.actor, c.bjj, c.coach.user.id).expect(403)
            await assign(c.w, c.ownerActor, c.bjj, c.student.id).expect(400)
            await assign(c.w, c.ownerActor, c.bjj, head.user.id).expect(400)
            // Idempotent.
            await assign(c.w, c.ownerActor, c.bjj, c.manager.user.id).expect(201)
            expect(await ctx.prisma.directionManager.count({ where: { workspaceId: c.w } })).toBe(2)
        })

        it('removing the assignment or demoting the coach takes the rights away', async () => {
            const c = await setup()
            const row = await ctx.prisma.directionManager.findFirstOrThrow({
                where: { workspaceId: c.w, userId: c.manager.user.id },
            })
            await http()
                .delete(`${ws(c.w)}/direction-managers/${row.id}`)
                .set(...c.manager.actor.auth)
                .expect(403)
            await http()
                .delete(`${ws(c.w)}/direction-managers/${row.id}`)
                .set(...c.ownerActor.auth)
                .expect(200)
            expect(
                await ctx.prisma.auditEvent.count({
                    where: { workspaceId: c.w, action: 'direction.managerRemove' },
                }),
            ).toBe(1)
            const res = await http()
                .post(`${ws(c.w)}/rank-ladders/${c.ladders.bjj.id}/levels`)
                .set(...c.manager.actor.auth)
                .send({ name: 'Фиолетовый', order: 2 })
            expect(res.status).toBe(403)

            await assign(c.w, c.ownerActor, c.bjj, c.manager.user.id).expect(201)
            const userRole = await ctx.prisma.role.findFirstOrThrow({ where: { name: 'user' } })
            await http()
                .patch(`${ws(c.w)}/members/${c.manager.user.id}/role`)
                .set(...c.ownerActor.auth)
                .send({ roleId: userRole.id })
                .expect(200)
            expect(
                await ctx.prisma.directionManager.count({ where: { userId: c.manager.user.id } }),
            ).toBe(0)
        })
    })

    describe('what a БЖЖ manager may write', () => {
        it('every direction-owned write in БЖЖ', async () => {
            const c = await setup()
            expectAll(await writes(c, c.manager.actor, 'bjj'), true)
        })

        it('none of them in ММА', async () => {
            const c = await setup()
            expectAll(await writes(c, c.manager.actor, 'mma'), false)
        })

        it('none of them club-wide', async () => {
            const c = await setup()
            expectAll(await writes(c, c.manager.actor, 'club'), false)
        })

        it('cannot move a БЖЖ row to ММА or make it club-wide', async () => {
            const c = await setup()
            const base = ws(c.w)
            const moves = [
                http().patch(`${base}/groups/${c.groups.bjj.id}`).send({ directionId: c.mma }),
                http().patch(`${base}/groups/${c.groups.bjj.id}`).send({ directionId: null }),
                http().patch(`${base}/rank-ladders/${c.ladders.bjj.id}`).send({ directionId: c.mma }),
            ]
            for (const req of moves) {
                const res = await req.set(...c.manager.actor.auth)
                expect(res.status).toBe(403)
            }
            const plan = await http()
                .post(`${base}/plans`)
                .set(...c.manager.actor.auth)
                .send({ name: 'БЖЖ 8', price: 400000, currency: 'RUB', durationDays: 30, directionId: c.bjj })
                .expect(201)
            await http()
                .patch(`${base}/plans/${plan.body.id}`)
                .set(...c.manager.actor.auth)
                .send({ directionId: c.mma })
                .expect(403)
            await http()
                .patch(`${base}/plans/${plan.body.id}`)
                .set(...c.manager.actor.auth)
                .send({ directionId: null })
                .expect(403)
            const group = await ctx.prisma.group.findUniqueOrThrow({ where: { id: c.groups.bjj.id } })
            expect(group.directionId).toBe(c.bjj)
        })

        it('admin-only lists show only БЖЖ', async () => {
            const c = await setup()
            const ladders = await http()
                .get(`${ws(c.w)}/rank-ladders`)
                .set(...c.manager.actor.auth)
                .expect(200)
            expect(ladders.body.data.map((l: { id: string }) => l.id)).toEqual([c.ladders.bjj.id])
        })

        it('club settings, billing, payment setup and roles stay admin-only', async () => {
            const c = await setup()
            const base = ws(c.w)
            const coachRole = await ctx.prisma.role.findFirstOrThrow({ where: { name: 'coach' } })
            const attempts = {
                settings: http().patch(`${base}/settings`).send({ name: 'Новое имя' }),
                billing: http().get(`${base}/billing`),
                paymentSettings: http()
                    .put(`${base}/payment-settings`)
                    .send({ provider: 'YOOKASSA', shopId: '123', secretKey: 'x' }),
                role: http()
                    .patch(`${base}/members/${c.student.id}/role`)
                    .send({ roleId: coachRole.id }),
                directions: http().post(`${base}/directions`).send({ name: 'Самбо' }),
                managers: http().get(`${base}/direction-managers`),
            }
            for (const [route, req] of Object.entries(attempts)) {
                const res = await req.set(...c.manager.actor.auth)
                expect({ route, status: res.status }).toEqual({ route, status: 403 })
            }
        })
    })

    describe('everyone else is unaffected', () => {
        it.each([
            ['the owner', 'owner'],
            ['a head coach', 'head'],
        ])('%s writes every direction and club-wide', async (_label, who) => {
            const c = await setup()
            const actor =
                who === 'owner'
                    ? c.ownerActor
                    : (await memberActor(c.w, RolesEnum.HEAD_COACH)).actor
            for (const target of ['bjj', 'mma', 'club'] as const) {
                expectAll(await writes(c, actor, target), true)
            }
        })

        it('a plain coach keeps exactly the coach rights', async () => {
            const c = await setup()
            const base = ws(c.w)
            // Admin-only before, admin-only now.
            for (const req of [
                http().post(`${base}/rank-ladders/${c.ladders.bjj.id}/levels`).send({ name: 'X', order: 5 }),
                http().get(`${base}/rank-ladders`),
                http().post(`${base}/plans`).send({ name: 'X', price: 1, currency: 'RUB', durationDays: 30 }),
                http().post(`${base}/achievements`).send({ name: 'X', threshold: 1 }),
                http().patch(`${base}/groups/${c.groups.bjj.id}`).send({ name: 'Чужая' }),
            ]) {
                const res = await req.set(...c.coach.actor.auth)
                expect(res.status).toBe(403)
            }
            // Their own group in any direction, and events, as before.
            await http()
                .post(`${base}/groups`)
                .set(...c.coach.actor.auth)
                .send({ name: 'Моя', gymId: c.gym.id, coachId: c.coach.user.id, directionId: c.mma })
                .expect(201)
            await http()
                .post(`${base}/events`)
                .set(...c.coach.actor.auth)
                .send({ title: 'Открытая', startAt: '2026-12-20T12:00', endAt: '2026-12-20T13:00' })
                .expect(201)
        })
    })

    describe('cross-club', () => {
        it('another club can neither read nor change these assignments, nor its manager act here', async () => {
            const c = await setup()
            const { workspace: other, owner: otherOwner } = await createWorkspace(ctx)
            const otherActor = await signIn(ctx, otherOwner.email)
            const row = await ctx.prisma.directionManager.findFirstOrThrow({
                where: { workspaceId: c.w },
            })

            await http().get(`${ws(c.w)}/direction-managers`).set(...otherActor.auth).expect(403)
            await assign(c.w, otherActor, c.bjj, c.coach.user.id).expect(403)
            await http()
                .delete(`${ws(c.w)}/direction-managers/${row.id}`)
                .set(...otherActor.auth)
                .expect(403)
            // Own club in the path, foreign ids: not found there.
            await http()
                .delete(`${ws(other.id)}/direction-managers/${row.id}`)
                .set(...otherActor.auth)
                .expect(404)
            const { user: otherCoach } = await addMember(ctx, {
                workspaceId: other.id,
                role: RolesEnum.COACH,
            })
            await assign(other.id, otherActor, c.bjj, otherCoach.id).expect(404)
            expect(await ctx.prisma.directionManager.count()).toBe(1)

            // A БЖЖ manager of club A has no rights in club B.
            await http()
                .post(`${ws(other.id)}/achievements`)
                .set(...c.manager.actor.auth)
                .send({ name: 'X', threshold: 1 })
                .expect(403)
        })
    })
})
