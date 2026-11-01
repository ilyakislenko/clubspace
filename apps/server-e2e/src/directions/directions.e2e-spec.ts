import { signIn, type Actor } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Directions (БЖЖ / ММА inside one club) against the real guards, handlers and
// database: the CRUD stays inside its club, and every direction-scoped read —
// achievements, announcements, course audience, leaderboard, class packs —
// counts and shows only what belongs to that direction, while a club without
// directions keeps its old behaviour.
describe('directions', () => {
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

    const createDirection = async (
        workspaceId: string,
        actor: Actor,
        name: string,
    ) => {
        const res = await ctx
            .http()
            .post(`${ws(workspaceId)}/directions`)
            .set(...actor.auth)
            .send({ name, color: '#2563eb', icon: '🥋' })
            .expect(201)
        return res.body as { id: string; name: string }
    }

    const createGroup = (
        workspaceId: string,
        coachId: string,
        name: string,
        directionId: string | null,
        memberIds: string[] = [],
    ) =>
        ctx.prisma.group.create({
            data: {
                workspaceId,
                name,
                coachId,
                directionId,
                coaches: { create: { userId: coachId, role: 'primary' } },
                members: { create: memberIds.map((userId) => ({ userId })) },
            },
        })

    let n = 0
    const sessionFor = (workspaceId: string, groupId: string, createdById: string) =>
        ctx.prisma.attendanceSession.create({
            data: {
                workspaceId,
                groupId,
                occurrenceKey: `adhoc:${groupId}:${++n}`,
                title: 'Тренировка',
                startAt: new Date(Date.now() - n * 60_000),
                timezone: 'Europe/Moscow',
                createdById,
            },
        })

    const mark = (workspaceId: string, sessionId: string, actor: Actor, userIds: string[]) =>
        ctx
            .http()
            .post(`${ws(workspaceId)}/attendance/sessions/${sessionId}/records`)
            .set(...actor.auth)
            .send({ userIds })
            .expect(201)

    // A club with БЖЖ and ММА groups; `bjjStudent` trains БЖЖ only,
    // `mmaStudent` ММА only.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: bjjStudent } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: mmaStudent } = await addMember(ctx, { workspaceId: workspace.id })
        const ownerActor = await signIn(ctx, owner.email)
        const bjjActor = await signIn(ctx, bjjStudent.email)
        const mmaActor = await signIn(ctx, mmaStudent.email)
        const bjj = await createDirection(workspace.id, ownerActor, 'БЖЖ')
        const mma = await createDirection(workspace.id, ownerActor, 'ММА')
        const bjjGroup = await createGroup(workspace.id, owner.id, 'БЖЖ взрослые', bjj.id, [bjjStudent.id])
        const mmaGroup = await createGroup(workspace.id, owner.id, 'ММА вечер', mma.id, [mmaStudent.id])
        return {
            workspace,
            owner,
            ownerActor,
            bjjStudent,
            mmaStudent,
            bjjActor,
            mmaActor,
            bjj,
            mma,
            bjjGroup,
            mmaGroup,
        }
    }

    describe('CRUD and isolation', () => {
        it('a member lists the club directions with their own marked; only admins write', async () => {
            const { workspace, bjjActor, bjj, mma } = await setup()
            const res = await ctx
                .http()
                .get(`${ws(workspace.id)}/directions`)
                .set(...bjjActor.auth)
                .expect(200)
            expect(res.body.data).toEqual([
                expect.objectContaining({ id: bjj.id, isMine: true, groupCount: 1 }),
                expect.objectContaining({ id: mma.id, isMine: false, groupCount: 1 }),
            ])
            await ctx
                .http()
                .post(`${ws(workspace.id)}/directions`)
                .set(...bjjActor.auth)
                .send({ name: 'Самбо' })
                .expect(403)
        })

        it('another club can neither read, edit, delete nor tag with these directions', async () => {
            const { workspace, bjj } = await setup()
            const { workspace: other, owner: otherOwner } = await createWorkspace(ctx)
            const otherActor = await signIn(ctx, otherOwner.email)

            await ctx
                .http()
                .get(`${ws(workspace.id)}/directions`)
                .set(...otherActor.auth)
                .expect(403)
            // Own club in the path, foreign direction id: not found there.
            await ctx
                .http()
                .patch(`${ws(other.id)}/directions/${bjj.id}`)
                .set(...otherActor.auth)
                .send({ name: 'Чужое' })
                .expect(404)
            await ctx
                .http()
                .delete(`${ws(other.id)}/directions/${bjj.id}`)
                .set(...otherActor.auth)
                .expect(404)
            // Tagging own rows with a foreign direction is refused everywhere.
            await ctx
                .http()
                .post(`${ws(other.id)}/plans`)
                .set(...otherActor.auth)
                .send({
                    name: 'Чужой БЖЖ',
                    price: 100,
                    currency: 'RUB',
                    durationDays: 30,
                    directionIds: [bjj.id],
                })
                .expect(404)
            await ctx
                .http()
                .post(`${ws(other.id)}/achievements`)
                .set(...otherActor.auth)
                .send({ name: 'Чужое', threshold: 1, directionId: bjj.id })
                .expect(404)
            await ctx
                .http()
                .get(`${ws(other.id)}/leaderboard`)
                .query({ directionId: bjj.id })
                .set(...otherActor.auth)
                .expect(404)

            const untouched = await ctx.prisma.direction.findUniqueOrThrow({
                where: { id: bjj.id },
            })
            expect(untouched.name).toBe('БЖЖ')
        })

        it('refuses to delete a direction still in use, deletes an unused one', async () => {
            const { workspace, ownerActor, bjj } = await setup()
            const res = await ctx
                .http()
                .delete(`${ws(workspace.id)}/directions/${bjj.id}`)
                .set(...ownerActor.auth)
                .expect(400)
            expect(res.body.message).toMatch(/используется/)

            const spare = await createDirection(workspace.id, ownerActor, 'Самбо')
            await ctx
                .http()
                .delete(`${ws(workspace.id)}/directions/${spare.id}`)
                .set(...ownerActor.auth)
                .expect(200)
        })
    })

    it('a direction achievement counts only that direction’s sessions', async () => {
        const { workspace, owner, ownerActor, bjjStudent, bjjActor, bjj, bjjGroup, mma } =
            await setup()
        // The same student also trains ММА.
        const mmaGroup2 = await createGroup(workspace.id, owner.id, 'ММА утро', mma.id, [bjjStudent.id])
        const create = (body: Record<string, unknown>) =>
            ctx
                .http()
                .post(`${ws(workspace.id)}/achievements`)
                .set(...ownerActor.auth)
                .send(body)
                .expect(201)
        const clubWide = (await create({ name: 'Две тренировки', threshold: 2 })).body
        const bjjTwo = (await create({ name: 'Два БЖЖ', threshold: 2, directionId: bjj.id })).body

        const s1 = await sessionFor(workspace.id, bjjGroup.id, owner.id)
        const s2 = await sessionFor(workspace.id, mmaGroup2.id, owner.id)
        await mark(workspace.id, s1.id, ownerActor, [bjjStudent.id])
        await mark(workspace.id, s2.id, ownerActor, [bjjStudent.id])

        type MyAchievements = {
            totalCheckIns: number
            achievements: Array<{ id: string; unlocked: boolean; directionId: string | null }>
            directions: Array<{ id: string; totalCheckIns: number }>
        }
        const read = async () =>
            (
                await ctx
                    .http()
                    .get(`${ws(workspace.id)}/me/achievements`)
                    .set(...bjjActor.auth)
                    .expect(200)
            ).body as MyAchievements
        const byId = (body: MyAchievements, id: string) =>
            body.achievements.find((a) => a.id === id)

        let body = await read()
        expect(body.totalCheckIns).toBe(2)
        expect(byId(body, clubWide.id)).toMatchObject({ unlocked: true, directionId: null })
        expect(byId(body, bjjTwo.id)).toMatchObject({ unlocked: false, directionId: bjj.id })
        expect(body.directions).toEqual([
            expect.objectContaining({ id: bjj.id, totalCheckIns: 1 }),
        ])

        const s3 = await sessionFor(workspace.id, bjjGroup.id, owner.id)
        await mark(workspace.id, s3.id, ownerActor, [bjjStudent.id])
        body = await read()
        expect(byId(body, bjjTwo.id)).toMatchObject({ unlocked: true })

        // The admin list counts the unlock per scope too.
        const list = await ctx
            .http()
            .get(`${ws(workspace.id)}/achievements`)
            .set(...ownerActor.auth)
            .expect(200)
        const unlockedBy = Object.fromEntries(
            (list.body.data as Array<{ id: string; unlockedBy: number }>).map((a) => [a.id, a.unlockedBy]),
        )
        expect(unlockedBy[bjjTwo.id]).toBe(1)
    })

    it('a direction announcement reaches only that direction (feed and push), staff see it', async () => {
        const { workspace, ownerActor, bjjStudent, mmaStudent, bjjActor, mmaActor, bjj } =
            await setup()
        const created = await ctx
            .http()
            .post(`${ws(workspace.id)}/announcements`)
            .set(...ownerActor.auth)
            .send({ title: 'Сбор БЖЖ', body: 'В субботу открытый ковёр', publish: true, directionId: bjj.id })
            .expect(201)
        expect(created.body.direction).toMatchObject({ id: bjj.id, name: 'БЖЖ' })

        const feedIds = async (actor: Actor) =>
            (
                (
                    await ctx
                        .http()
                        .get(`${ws(workspace.id)}/announcements/feed`)
                        .set(...actor.auth)
                        .expect(200)
                ).body.data as Array<{ id: string }>
            ).map((a) => a.id)

        expect(await feedIds(bjjActor)).toEqual([created.body.id])
        expect(await feedIds(mmaActor)).toEqual([])
        expect(await feedIds(ownerActor)).toEqual([created.body.id])

        const pushed = await ctx.prisma.notification.findMany({
            where: { userId: { in: [bjjStudent.id, mmaStudent.id] } },
            select: { userId: true, metadata: true },
        })
        const announcementPushes = pushed.filter(
            (p) => (p.metadata as { kind?: string } | null)?.kind === 'announcement.published',
        )
        expect(announcementPushes.map((p) => p.userId)).toEqual([bjjStudent.id])
    })

    it('a course for a direction is visible to its members only', async () => {
        const { workspace, ownerActor, bjjActor, mmaActor, bjj } = await setup()
        const course = await ctx.prisma.course.create({
            data: {
                workspaceId: workspace.id,
                title: 'БЖЖ: гарды',
                slug: 'bjj-guards',
                publishedAt: new Date(Date.now() - 60_000),
            },
        })
        const saved = await ctx
            .http()
            .put(`${ws(workspace.id)}/playlists/${course.id}/audience`)
            .set(...ownerActor.auth)
            .send({ groupIds: [], rankLevelIds: [], planIds: [], directionIds: [bjj.id] })
            .expect(200)
        expect(saved.body.directionIds).toEqual([bjj.id])

        const listIds = async (actor: Actor) =>
            (
                (
                    await ctx
                        .http()
                        .get(`${ws(workspace.id)}/playlists`)
                        .set(...actor.auth)
                        .expect(200)
                ).body.data as Array<{ id: string }>
            ).map((c) => c.id)
        expect(await listIds(bjjActor)).toEqual([course.id])
        expect(await listIds(mmaActor)).toEqual([])
        await ctx
            .http()
            .get(`${ws(workspace.id)}/playlists/${course.id}`)
            .set(...bjjActor.auth)
            .expect(200)
        await ctx
            .http()
            .get(`${ws(workspace.id)}/playlists/${course.id}`)
            .set(...mmaActor.auth)
            .expect(404)

        // Another club's direction can't be bound to the course.
        const { workspace: other, owner: otherOwner } = await createWorkspace(ctx)
        const otherDirection = await createDirection(other.id, await signIn(ctx, otherOwner.email), 'Чужое')
        await ctx
            .http()
            .put(`${ws(workspace.id)}/playlists/${course.id}/audience`)
            .set(...ownerActor.auth)
            .send({ groupIds: [], rankLevelIds: [], planIds: [], directionIds: [otherDirection.id] })
            .expect(404)
    })

    it('the leaderboard of a direction counts only its sessions', async () => {
        const { workspace, owner, ownerActor, bjjStudent, mmaStudent, bjjActor, bjj, bjjGroup, mmaGroup } =
            await setup()
        const s1 = await sessionFor(workspace.id, bjjGroup.id, owner.id)
        const s2 = await sessionFor(workspace.id, mmaGroup.id, owner.id)
        const s3 = await sessionFor(workspace.id, mmaGroup.id, owner.id)
        await mark(workspace.id, s1.id, ownerActor, [bjjStudent.id])
        await mark(workspace.id, s2.id, ownerActor, [mmaStudent.id])
        await mark(workspace.id, s3.id, ownerActor, [mmaStudent.id])

        const board = async (directionId?: string) =>
            (
                await ctx
                    .http()
                    .get(`${ws(workspace.id)}/leaderboard`)
                    .query(directionId ? { directionId } : {})
                    .set(...bjjActor.auth)
                    .expect(200)
            ).body as { entries: Array<{ userId: string; checkins: number }> }

        expect((await board()).entries.map((e) => [e.userId, e.checkins])).toEqual([
            [mmaStudent.id, 2],
            [bjjStudent.id, 1],
        ])
        expect((await board(bjj.id)).entries.map((e) => [e.userId, e.checkins])).toEqual([
            [bjjStudent.id, 1],
        ])
    })

    it('a per-direction pack is drawn only by its direction’s classes', async () => {
        const { workspace, owner, ownerActor, bjjStudent, bjj, bjjGroup, mmaGroup } = await setup()
        const created = await ctx
            .http()
            .post(`${ws(workspace.id)}/plans`)
            .set(...ownerActor.auth)
            .send({
                name: 'БЖЖ 12 занятий',
                price: 6000,
                currency: 'RUB',
                durationDays: 30,
                classCount: 12,
                directionIds: [bjj.id],
            })
            .expect(201)
        expect(created.body.directions).toEqual([
            expect.objectContaining({ id: bjj.id, name: 'БЖЖ' }),
        ])
        await ctx
            .http()
            .post(`${ws(workspace.id)}/members/${bjjStudent.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: created.body.id })
            .expect(201)
        // The student also drops in to an ММА class.
        await ctx.prisma.groupMember.create({
            data: { groupId: mmaGroup.id, userId: bjjStudent.id },
        })
        const remaining = async () =>
            (
                await ctx.prisma.subscription.findFirstOrThrow({
                    where: { workspaceId: workspace.id },
                })
            ).classesRemaining

        const mmaSession = await sessionFor(workspace.id, mmaGroup.id, owner.id)
        await mark(workspace.id, mmaSession.id, ownerActor, [bjjStudent.id])
        expect(await remaining()).toBe(12)

        const bjjSession = await sessionFor(workspace.id, bjjGroup.id, owner.id)
        await mark(workspace.id, bjjSession.id, ownerActor, [bjjStudent.id])
        expect(await remaining()).toBe(11)
    })

    it('a club without directions behaves as before', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        const ownerActor = await signIn(ctx, owner.email)
        const studentActor = await signIn(ctx, student.email)
        const group = await createGroup(workspace.id, owner.id, 'Вечерняя', null, [student.id])
        const plan = await createPlan(ctx, { workspaceId: workspace.id, classCount: 8 })
        await ctx
            .http()
            .post(`${ws(workspace.id)}/members/${student.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const session = await sessionFor(workspace.id, group.id, owner.id)
        await mark(workspace.id, session.id, ownerActor, [student.id])

        // Any class draws a club-wide pack.
        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        expect(sub.classesRemaining).toBe(7)

        const directions = await ctx
            .http()
            .get(`${ws(workspace.id)}/directions`)
            .set(...studentActor.auth)
            .expect(200)
        expect(directions.body.data).toEqual([])

        // Built-in ladder, no direction sections.
        const achievements = await ctx
            .http()
            .get(`${ws(workspace.id)}/me/achievements`)
            .set(...studentActor.auth)
            .expect(200)
        expect(achievements.body.totalCheckIns).toBe(1)
        expect(achievements.body.directions).toEqual([])
        expect(achievements.body.achievements[0]).toMatchObject({
            id: 'default-1',
            unlocked: true,
            directionId: null,
        })

        // A club-wide announcement reaches everyone.
        const created = await ctx
            .http()
            .post(`${ws(workspace.id)}/announcements`)
            .set(...ownerActor.auth)
            .send({ title: 'Для всех', body: 'Зал закрыт в понедельник', publish: true })
            .expect(201)
        expect(created.body.direction).toBeNull()
        const feed = await ctx
            .http()
            .get(`${ws(workspace.id)}/announcements/feed`)
            .set(...studentActor.auth)
            .expect(200)
        expect(feed.body.data.map((a: { id: string }) => a.id)).toEqual([created.body.id])

        const board = await ctx
            .http()
            .get(`${ws(workspace.id)}/leaderboard`)
            .set(...studentActor.auth)
            .expect(200)
        expect(board.body).toMatchObject({ directionId: null })
        expect(board.body.entries).toEqual([
            expect.objectContaining({ userId: student.id, checkins: 1 }),
        ])
    })
})
