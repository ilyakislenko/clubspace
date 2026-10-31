import { signIn, type Actor } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Course audience (group / minimum rank / plan) and locked progression,
// against the real guards, serializers and database: a student outside the
// audience can't list, open, play, download or record progress; promotion
// and watching the previous lesson unlock things without any cache to bust.
describe('content gating', () => {
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

    const createVideo = (workspaceId: string, title: string) =>
        ctx.prisma.video.create({
            data: {
                workspaceId,
                title,
                url: 'https://example.invalid/v.mp4',
                status: 'ready',
                hlsBucket: 'test-bucket',
                hlsMasterKey: `hls/${title}/master.m3u8`,
                // Offline download only signs a URL for the raw object.
                rawBucket: 'test-bucket',
                rawKey: `raw/${title}/source.mp4`,
                duration: 100,
            },
        })

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        const v1 = await createVideo(workspace.id, 'lesson-1')
        const v2 = await createVideo(workspace.id, 'lesson-2')
        const course = await ctx.prisma.course.create({
            data: {
                workspaceId: workspace.id,
                title: 'Синий курс',
                slug: 'blue',
                publishedAt: new Date(Date.now() - 60_000),
                videos: {
                    create: [
                        { videoId: v1.id, order: 0 },
                        { videoId: v2.id, order: 1 },
                    ],
                },
            },
        })
        const ownerActor = await signIn(ctx, owner.email)
        const studentActor = await signIn(ctx, student.email)
        return { workspace, course, v1, v2, student, ownerActor, studentActor }
    }

    const base = (workspaceId: string) => `/workspaces/${workspaceId}/playlists`

    const setAudience = (
        workspaceId: string,
        courseId: string,
        actor: Actor,
        body: { groupIds?: string[]; rankLevelIds?: string[]; planIds?: string[] },
    ) =>
        ctx
            .http()
            .put(`${base(workspaceId)}/${courseId}/audience`)
            .set(...actor.auth)
            .send({ groupIds: [], rankLevelIds: [], planIds: [], ...body })

    const listIds = async (workspaceId: string, actor: Actor) => {
        const res = await ctx
            .http()
            .get(base(workspaceId))
            .set(...actor.auth)
            .expect(200)
        return res.body.data as Array<{ id: string; lock: unknown }>
    }

    const play = (videoId: string, actor: Actor) =>
        ctx.http().get(`/videos/${videoId}/playback`).set(...actor.auth)

    const download = (videoId: string, actor: Actor) =>
        ctx.http().get(`/videos/${videoId}/offline-download`).set(...actor.auth)

    it('hides a group course from students outside the group until they join', async () => {
        const { workspace, course, v1, student, ownerActor, studentActor } =
            await setup()
        const group = await ctx.prisma.group.create({
            data: { workspaceId: workspace.id, name: 'Дети', coachId: ownerActor.userId },
        })

        const saved = await setAudience(workspace.id, course.id, ownerActor, {
            groupIds: [group.id],
        })
        expect(saved.status).toBe(200)
        expect(saved.body).toMatchObject({
            groupIds: [group.id],
            summary: 'Для группы «Дети»',
        })

        expect(await listIds(workspace.id, studentActor)).toEqual([])
        await ctx
            .http()
            .get(`${base(workspace.id)}/${course.id}`)
            .set(...studentActor.auth)
            .expect(404)
        expect((await play(v1.id, studentActor)).status).toBe(404)
        expect((await download(v1.id, studentActor)).status).toBe(404)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/videos/${v1.id}`)
            .set(...studentActor.auth)
            .expect(404)
        await ctx
            .http()
            .post(`/videos/${v1.id}/progress`)
            .set(...studentActor.auth)
            .send({ position: 1 })
            .expect(404)

        // Staff always see it, with the audience spelled out.
        const staffList = await ctx
            .http()
            .get(base(workspace.id))
            .set(...ownerActor.auth)
            .expect(200)
        expect(staffList.body.data[0]).toMatchObject({
            id: course.id,
            lock: null,
            audienceSummary: 'Для группы «Дети»',
        })
        expect((await play(v1.id, ownerActor)).status).toBe(200)

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/groups/${group.id}/members`)
            .set(...ownerActor.auth)
            .send({ userId: student.id })
            .expect(201)

        const visible = await listIds(workspace.id, studentActor)
        expect(visible.map((c) => c.id)).toEqual([course.id])
        expect(visible[0].lock).toBeNull()
        expect((await play(v1.id, studentActor)).status).toBe(200)
    })

    it('teases a rank course and unlocks it after promotion', async () => {
        const { workspace, course, v1, student, ownerActor, studentActor } =
            await setup()
        const ladder = await ctx.prisma.rankLadder.create({
            data: {
                workspaceId: workspace.id,
                name: 'Взрослые',
                levels: {
                    create: [
                        { name: 'Белый пояс', order: 0 },
                        { name: 'Синий пояс', order: 1 },
                    ],
                },
            },
            include: { levels: { orderBy: { order: 'asc' } } },
        })
        const [white, blue] = ladder.levels
        const promote = (levelId: string) =>
            ctx
                .http()
                .post(`/workspaces/${workspace.id}/members/${student.id}/rank`)
                .set(...ownerActor.auth)
                .send({ ladderId: ladder.id, levelId })
                .expect(201)
        await promote(white.id)

        await setAudience(workspace.id, course.id, ownerActor, {
            rankLevelIds: [blue.id],
        }).expect(200)

        const lock = { kind: 'RANK', reason: 'Доступно с уровня «Синий пояс»' }
        const listed = await listIds(workspace.id, studentActor)
        expect(listed).toEqual([expect.objectContaining({ id: course.id, lock })])

        const detail = await ctx
            .http()
            .get(`${base(workspace.id)}/${course.id}`)
            .set(...studentActor.auth)
            .expect(200)
        expect(detail.body.lock).toEqual(lock)
        expect(detail.body.videos.map((v: { lock: unknown }) => v.lock)).toEqual([
            lock,
            lock,
        ])

        const refused = await play(v1.id, studentActor)
        expect(refused.status).toBe(403)
        expect(refused.body.message).toBe('Доступно с уровня «Синий пояс»')
        expect((await download(v1.id, studentActor)).status).toBe(403)

        await promote(blue.id)

        expect((await listIds(workspace.id, studentActor))[0].lock).toBeNull()
        expect((await play(v1.id, studentActor)).status).toBe(200)
        const offline = await download(v1.id, studentActor)
        expect(offline.status).toBe(200)
        // Short-lived link: 30 minutes, not hours.
        expect(offline.body.url).toMatch(/X-Amz-Expires=1800/)
    })

    it('locks a plan course until the student holds that abonement', async () => {
        const { workspace, course, v1, student, ownerActor, studentActor } =
            await setup()
        const plan = await createPlan(ctx, { workspaceId: workspace.id, name: 'Безлимит' })
        await setAudience(workspace.id, course.id, ownerActor, {
            planIds: [plan.id],
        }).expect(200)

        const refused = await play(v1.id, studentActor)
        expect(refused.status).toBe(403)
        expect(refused.body.message).toBe('Доступно по абонементу «Безлимит»')

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${student.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)

        expect((await play(v1.id, studentActor)).status).toBe(200)
    })

    it('opens lessons one by one under locked progression', async () => {
        const { workspace, course, v1, v2, ownerActor, studentActor } = await setup()
        await ctx
            .http()
            .patch(`${base(workspace.id)}/${course.id}`)
            .set(...ownerActor.auth)
            .send({ lockedProgression: true })
            .expect(200)

        const lessons = async () =>
            (
                await ctx
                    .http()
                    .get(`${base(workspace.id)}/${course.id}`)
                    .set(...studentActor.auth)
                    .expect(200)
            ).body.videos.map((v: { lock: { kind: string } | null }) => v.lock?.kind ?? null)

        expect(await lessons()).toEqual([null, 'PROGRESSION'])
        const refused = await play(v2.id, studentActor)
        expect(refused.status).toBe(403)
        expect(refused.body.message).toBe('Сначала посмотрите предыдущий урок')
        await ctx
            .http()
            .post(`/videos/${v2.id}/progress`)
            .set(...studentActor.auth)
            .send({ position: 99, duration: 100 })
            .expect(403)

        // "Mark watched" without watching doesn't count in a sequential course.
        const marked = await ctx
            .http()
            .post(`/videos/${v1.id}/progress`)
            .set(...studentActor.auth)
            .send({ position: 3, duration: 100, completed: true })
            .expect(200)
        expect(marked.body.completed).toBe(false)
        expect(await lessons()).toEqual([null, 'PROGRESSION'])

        await ctx
            .http()
            .post(`/videos/${v1.id}/progress`)
            .set(...studentActor.auth)
            .send({ position: 92, duration: 100 })
            .expect(200)

        expect(await lessons()).toEqual([null, null])
        expect((await play(v2.id, studentActor)).status).toBe(200)

        // Staff are never locked.
        expect((await play(v2.id, ownerActor)).status).toBe(200)
    })

    it('keeps the audience editor to coaching staff and this club', async () => {
        const { workspace, course, ownerActor, studentActor } = await setup()
        await ctx
            .http()
            .get(`${base(workspace.id)}/${course.id}/audience`)
            .set(...studentActor.auth)
            .expect(403)
        await setAudience(workspace.id, course.id, studentActor, {}).expect(403)

        const other = await createWorkspace(ctx)
        const foreignGroup = await ctx.prisma.group.create({
            data: { workspaceId: other.workspace.id, name: 'Чужая', coachId: other.owner.id },
        })
        await setAudience(workspace.id, course.id, ownerActor, {
            groupIds: [foreignGroup.id],
        }).expect(404)

        const audience = await ctx
            .http()
            .get(`${base(workspace.id)}/${course.id}/audience`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(audience.body).toMatchObject({ groupIds: [], summary: null })
    })
})
