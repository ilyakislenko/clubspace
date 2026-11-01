import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// C1: admin/videos carries the club in the query (GET/DELETE) or the body
// (POST/PATCH), not in the path. The guards used to authorize the club named in
// the body while the handlers acted on the club named in the query, so a coach
// of club A sent A in the body and B in the query and listed, read or deleted
// club B's videos. One resolver now feeds guards and handlers, and a request
// naming two different clubs is refused outright.
//
// H1 rides along: the subtitle storageKey is stored and later deleted from the
// bucket every club shares, so only a key issued for that very track passes.

describe('workspaceId cannot be mixed across request parts', () => {
    let ctx: TestApp
    let clubA: string
    let clubB: string
    let videoA: string
    let videoB: string
    let coachA: [string, string]

    beforeAll(async () => {
        ctx = await createTestApp()
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        const a = await createWorkspace(ctx, { name: 'Attacker Club' })
        const b = await createWorkspace(ctx, { name: 'Victim Club' })
        clubA = a.workspace.id
        clubB = b.workspace.id

        const coach = await addMember(ctx, {
            workspaceId: clubA,
            role: RolesEnum.COACH,
        })
        coachA = (await signIn(ctx, coach.user.email)).auth

        const make = (workspaceId: string, title: string) =>
            ctx.prisma.video.create({
                data: {
                    workspaceId,
                    title,
                    url: 'https://example.invalid/v.mp4',
                    status: 'ready',
                },
                select: { id: true },
            })
        videoA = (await make(clubA, 'Club A video')).id
        videoB = (await make(clubB, 'Club B video')).id
    })

    afterAll(async () => {
        await ctx?.close()
    })

    const victimVideoStillExists = async () =>
        expect(
            await ctx.prisma.video.findUnique({ where: { id: videoB } }),
        ).not.toBeNull()

    // Positive control: without it every refusal below is equally satisfied
    // by a route that refuses the coach for any reason.
    it('lets the coach use their own club, named in both places', async () => {
        const list = await ctx
            .http()
            .get(`/admin/videos?workspaceId=${clubA}`)
            .set(...coachA)
            .send({ workspaceId: clubA })
        expect(list.status).toBe(200)
        expect(list.body.data.map((v: { id: string }) => v.id)).toEqual([
            videoA,
        ])

        const one = await ctx
            .http()
            .get(`/admin/videos/${videoA}?workspaceId=${clubA}`)
            .set(...coachA)
        expect(one.status).toBe(200)
    })

    it.each([
        ['victim in the query, own club in the body', () => [clubB, clubA]],
        ['own club in the query, victim in the body', () => [clubA, clubB]],
    ])('refuses listing with %s', async (_label, ids) => {
        const [query, body] = ids()
        const res = await ctx
            .http()
            .get(`/admin/videos?workspaceId=${query}`)
            .set(...coachA)
            .send({ workspaceId: body })

        expect(res.status).toBe(400)
        expect(JSON.stringify(res.body)).not.toContain(videoB)
    })

    it('refuses reading a victim video by mixing body and query', async () => {
        const res = await ctx
            .http()
            .get(`/admin/videos/${videoB}?workspaceId=${clubB}`)
            .set(...coachA)
            .send({ workspaceId: clubA })

        expect(res.status).toBe(400)
        expect(JSON.stringify(res.body)).not.toContain('Club B video')
    })

    it('refuses deleting a victim video by mixing body and query', async () => {
        const res = await ctx
            .http()
            .delete(`/admin/videos/${videoB}?workspaceId=${clubB}`)
            .set(...coachA)
            .send({ workspaceId: clubA })

        expect(res.status).toBe(400)
        await victimVideoStillExists()
    })

    it('refuses a bulk delete that names the victim in the query', async () => {
        const res = await ctx
            .http()
            .post(`/admin/videos/bulk?workspaceId=${clubB}`)
            .set(...coachA)
            .send({ workspaceId: clubA, videoIds: [videoB], action: 'delete' })

        expect(res.status).toBe(400)
        await victimVideoStillExists()
    })

    it('refuses a repeated workspaceId query parameter', async () => {
        const res = await ctx
            .http()
            .get(`/admin/videos?workspaceId=${clubA}&workspaceId=${clubB}`)
            .set(...coachA)

        expect(res.status).toBe(400)
    })

    // Naming only the victim is the honest version of the request: it gets
    // past nothing, and the membership check is what refuses it.
    it.each([
        ['list', 'get', () => `/admin/videos?workspaceId=${clubB}`],
        ['read', 'get', () => `/admin/videos/${videoB}?workspaceId=${clubB}`],
        ['delete', 'delete', () => `/admin/videos/${videoB}?workspaceId=${clubB}`],
    ] as const)('refuses a %s naming only the victim club', async (_l, method, url) => {
        const res = await ctx.http()[method](url()).set(...coachA)

        expect(res.status).toBe(403)
        await victimVideoStillExists()
    })

    it('refuses a path club contradicted by the query', async () => {
        const res = await ctx
            .http()
            .get(`/workspaces/${clubA}/videos/${videoA}?workspaceId=${clubB}`)
            .set(...coachA)

        expect(res.status).toBe(400)
    })

    describe('subtitle storage keys', () => {
        const subtitles = () =>
            `/workspaces/${clubA}/videos/${videoA}/subtitles`

        it.each([
            ['another club\'s source video', () => `raw/${videoB}/source.mp4`],
            ['another club\'s HLS output', () => `hls/${videoB}/master.m3u8`],
            [
                'another video\'s track',
                () =>
                    `subtitles/${videoB}/ru/00000000-0000-4000-8000-000000000000.vtt`,
            ],
        ])('refuses a key pointing at %s', async (_label, key) => {
            const res = await ctx
                .http()
                .post(subtitles())
                .set(...coachA)
                .send({ language: 'ru', label: 'Русские', storageKey: key() })

            expect(res.status).toBe(400)
            expect(
                await ctx.prisma.videoSubtitle.count({
                    where: { videoId: videoA },
                }),
            ).toBe(0)
        })

        it('accepts the key it issued and derives the public URL itself', async () => {
            const upload = await ctx
                .http()
                .post(`${subtitles()}/upload-url`)
                .set(...coachA)
                .send({ language: 'ru', contentType: 'text/vtt' })
            expect(upload.status).toBe(201)

            const res = await ctx
                .http()
                .post(subtitles())
                .set(...coachA)
                .send({
                    language: 'ru',
                    label: 'Русские',
                    storageKey: upload.body.key,
                    // Ignored: an older admin bundle still sends it.
                    publicUrl: 'https://evil.example/track.vtt',
                })

            expect(res.status).toBe(201)
            expect(res.body.publicUrl).toBe(upload.body.publicUrl)
        })
    })
})
