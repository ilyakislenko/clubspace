import { signIn } from '../support/actors'
import { createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const CODE = 'ABCD2345'

// Joining a club by its code: the caller is signed in but belongs to no club,
// so these routes must be reachable with AuthGuard alone, and an unknown code,
// a request and a rejection must each be told apart honestly.
describe('join a club by code', () => {
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

    const club = async (data: { joinAutoApprove?: boolean } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx, {
            name: 'Tomsk Club',
        })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: workspace.id, code: CODE },
        })
        if (Object.keys(data).length > 0) {
            await ctx.prisma.workspace.update({
                where: { id: workspace.id },
                data,
            })
        }
        return { workspace, owner }
    }

    const join = (
        actor: { auth: [string, string] },
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post('/workspaces/join')
            .set(...actor.auth)
            .send(body)

    it('lets a user with no club reach the join routes (no membership 403)', async () => {
        const actor = await signIn(ctx, 'newbie@example.com')

        const list = await ctx
            .http()
            .get('/me/join-requests')
            .set(...actor.auth)
            .expect(200)
        expect(list.body).toEqual({ data: [] })

        // Reaches the handler (404 for the code), not the guards (403).
        await join(actor, { code: 'ZZZZ-9999' }).expect(404)
    })

    it('answers an unknown or malformed code with the same 404', async () => {
        await club()
        const actor = await signIn(ctx, 'newbie@example.com')

        for (const code of ['ZZZZ-9999', 'nope', 'ABCD-2340']) {
            const res = await join(actor, {
                code,
                firstname: 'Ann',
                lastname: 'Lee',
            }).expect(404)
            expect(res.body.message).toBe('Клуб с таким кодом не найден')
        }
    })

    it('does not reveal an inactive club', async () => {
        const { workspace } = await club()
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { isActive: false },
        })
        const actor = await signIn(ctx, 'newbie@example.com')
        await join(actor, { code: CODE, firstname: 'A', lastname: 'B' }).expect(
            404,
        )
    })

    it('asks for a name first, then files a pending request', async () => {
        const { workspace } = await club()
        const actor = await signIn(ctx, 'newbie@example.com')

        const noName = await join(actor, { code: CODE }).expect(400)
        expect(noName.body.message).toBe(
            'Укажите имя и фамилию — так клуб поймёт, кто подаёт заявку',
        )
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { workspaceId: workspace.id, userId: actor.userId },
            }),
        ).toBe(0)

        const first = await join(actor, {
            code: CODE,
            firstname: 'Ann',
            lastname: 'Lee',
        }).expect(201)
        expect(first.body).toEqual({
            status: 'pending',
            created: true,
            workspaceId: workspace.id,
            workspaceName: 'Tomsk Club',
        })

        const user = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: actor.userId },
        })
        expect(user).toMatchObject({ firstname: 'Ann', lastname: 'Lee' })

        // Again: nothing new, still pending, and no name needed any more.
        const again = await join(actor, { code: CODE }).expect(201)
        expect(again.body).toMatchObject({ status: 'pending', created: false })

        const list = await ctx
            .http()
            .get('/me/join-requests')
            .set(...actor.auth)
            .expect(200)
        expect(list.body.data).toEqual([
            expect.objectContaining({
                workspaceId: workspace.id,
                workspaceName: 'Tomsk Club',
                workspaceKey: workspace.key,
                status: 'pending',
            }),
        ])
    })

    it('accepts the code in lowercase with a hyphen', async () => {
        await club()
        const actor = await signIn(ctx, 'newbie@example.com')
        const res = await join(actor, {
            code: 'abcd-2345',
            firstname: 'Ann',
            lastname: 'Lee',
        }).expect(201)
        expect(res.body.status).toBe('pending')
    })

    it('tells the owner (inbox and e-mail, linking to the admin host)', async () => {
        const { workspace, owner } = await club()
        const actor = await signIn(ctx, 'newbie@example.com')
        await join(actor, { code: CODE, firstname: 'Ann', lastname: 'Lee' }).expect(
            201,
        )

        const rows = await ctx.prisma.notification.findMany({
            where: { userId: owner.id },
        })
        const pending = rows.filter(
            (n) =>
                (n.metadata as { kind?: string } | null)?.kind ===
                'member.join_requested',
        )
        expect(pending).toHaveLength(1)
        expect(pending[0].message).toContain('Ann Lee')
        expect(pending[0].message).toContain('newbie@example.com')

        const mail = await ctx.mail.waitFor((m) => m.to === owner.email)
        // The admin host (dev default in the suite), never the API ROOT_URL.
        expect(mail.html).toContain(
            `http://localhost:4200/workspace/${workspace.id}/users`,
        )
        expect(mail.html).not.toContain('http://localhost:3000/workspace')
    })

    it('shows a rejected applicant that they were rejected', async () => {
        const { workspace, owner } = await club()
        const ownerActor = await signIn(ctx, owner.email)
        const actor = await signIn(ctx, 'newbie@example.com')
        await join(actor, { code: CODE, firstname: 'Ann', lastname: 'Lee' }).expect(
            201,
        )

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${actor.userId}/reject`)
            .set(...ownerActor.auth)
            .expect(201)

        const res = await join(actor, { code: CODE }).expect(201)
        expect(res.body).toMatchObject({ status: 'rejected', created: false })

        const list = await ctx
            .http()
            .get('/me/join-requests')
            .set(...actor.auth)
            .expect(200)
        expect(list.body.data[0]).toMatchObject({ status: 'rejected' })
    })

    it('approving a request tells the applicant by e-mail and inbox', async () => {
        const { workspace, owner } = await club()
        const ownerActor = await signIn(ctx, owner.email)
        const actor = await signIn(ctx, 'newbie@example.com')
        await join(actor, { code: CODE, firstname: 'Ann', lastname: 'Lee' }).expect(
            201,
        )

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .send({ email: 'newbie@example.com' })
            .expect(201)

        const mail = await ctx.mail.waitFor(
            (m) => m.to === 'newbie@example.com' && m.html.includes('Tomsk Club'),
        )
        expect(mail.html).toContain('http://localhost:8081')

        const inbox = await ctx.prisma.notification.findMany({
            where: { userId: actor.userId },
        })
        expect(
            inbox.some(
                (n) =>
                    (n.metadata as { kind?: string } | null)?.kind ===
                    'member.approved',
            ),
        ).toBe(true)

        const mine = await ctx
            .http()
            .post('/get-my-workspaces')
            .set(...actor.auth)
            .send({})
            .expect(201)
        expect(mine.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toContain(
            workspace.id,
        )
    })

    it('joins straight away when the club auto-approves', async () => {
        const { workspace, owner } = await club({ joinAutoApprove: true })
        const actor = await signIn(ctx, 'newbie@example.com')

        const res = await join(actor, {
            code: CODE,
            firstname: 'Ann',
            lastname: 'Lee',
        }).expect(201)
        expect(res.body).toMatchObject({ status: 'active', created: true })

        const mine = await ctx
            .http()
            .post('/get-my-workspaces')
            .set(...actor.auth)
            .send({})
            .expect(201)
        expect(mine.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toContain(
            workspace.id,
        )

        // Staff hear "joined", not "requested".
        const kinds = (
            await ctx.prisma.notification.findMany({ where: { userId: owner.id } })
        ).map((n) => (n.metadata as { kind?: string } | null)?.kind)
        expect(kinds).toContain('member.joined')
        expect(kinds).not.toContain('member.join_requested')
    })

    it('settles an older pending request once the club auto-approves', async () => {
        const { workspace } = await club()
        const actor = await signIn(ctx, 'newbie@example.com')
        await join(actor, { code: CODE, firstname: 'Ann', lastname: 'Lee' })
            .expect(201)
            .expect((r) => expect(r.body.status).toBe('pending'))

        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { joinAutoApprove: true },
        })
        const res = await join(actor, { code: CODE }).expect(201)
        expect(res.body).toMatchObject({ status: 'active' })
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { workspaceId: workspace.id, status: 'ACTIVE' },
            }),
        ).toBeGreaterThanOrEqual(1)
    })

    it('answers the owner with active and creates no member row', async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: workspace.id, code: CODE },
        })
        const actor = await signIn(ctx, owner.email)
        const res = await join(actor, { code: CODE }).expect(201)
        expect(res.body).toMatchObject({ status: 'active', created: false })
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { workspaceId: workspace.id },
            }),
        ).toBe(0)
    })
})
