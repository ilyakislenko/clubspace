import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createUser,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Security M8: a club can no longer enrol someone who already has an account.
// It sends an offer; nothing changes for the person until they accept it in
// the app, and the club's answer never says whether the account existed.
describe('invitations for existing accounts', () => {
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

    const myClubs = async (actor: { auth: [string, string] }) =>
        (
            await ctx.http().post('/get-my-workspaces').set(...actor.auth).send({}).expect(201)
        ).body.data.map((w: { workspaceId: string }) => w.workspaceId)

    const myInvitations = async (actor: { auth: [string, string] }) =>
        (await ctx.http().get('/me/invitations').set(...actor.auth).expect(200)).body.data

    it('invite → offer in the app → accept: member with the offered role and group', async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Yoga Studio' })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek: 2,
            name: 'Утро',
        })
        const person = await createUser(ctx, { email: 'ann@example.com', firstname: 'Ann' })
        const personActor = await signIn(ctx, person.email)
        const ownerActor = await signIn(ctx, owner.email)

        const res = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/invite`)
            .set(...ownerActor.auth)
            .send({
                email: 'Ann@Example.com',
                role: 'coach',
                groupId: group.id,
                firstname: 'Renamed',
            })
            .expect(201)
        expect(res.body).toEqual({
            userId: person.id,
            email: 'ann@example.com',
            roleName: 'coach',
            outcome: 'invited',
            emailSent: true,
            groupId: null,
        })

        // Not a member yet, and the club did not touch the global profile.
        expect(await myClubs(personActor)).not.toContain(workspace.id)
        expect(
            (await ctx.prisma.user.findUniqueOrThrow({ where: { id: person.id } })).firstname,
        ).toBe('Ann')

        // The admin sees it as awaiting acceptance.
        const pending = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/invitations`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(pending.body.data).toEqual([
            expect.objectContaining({ email: 'ann@example.com', roleName: 'coach' }),
        ])

        // The person got an inbox entry and sees the offer.
        const inbox = await ctx.prisma.notification.findMany({ where: { userId: person.id } })
        expect(
            inbox.some((n) => (n.metadata as { kind?: string } | null)?.kind === 'member.invitation'),
        ).toBe(true)
        const offers = await myInvitations(personActor)
        expect(offers).toEqual([
            expect.objectContaining({
                workspaceId: workspace.id,
                workspaceName: 'Yoga Studio',
                roleName: 'coach',
                groupName: 'Утро',
            }),
        ])

        const accepted = await ctx
            .http()
            .post(`/me/invitations/${offers[0].id}/accept`)
            .set(...personActor.auth)
            .expect(201)
        expect(accepted.body).toEqual({
            workspaceId: workspace.id,
            workspaceName: 'Yoga Studio',
            roleName: 'coach',
            groupId: group.id,
        })
        expect(await myClubs(personActor)).toContain(workspace.id)
        expect(
            await ctx.prisma.groupCoach.count({
                where: { groupId: group.id, userId: person.id, role: 'assistant' },
            }),
        ).toBe(1)
        expect(await myInvitations(personActor)).toEqual([])
        expect(
            await ctx.prisma.auditEvent.count({
                where: { action: 'member.acceptInvitation', workspaceId: workspace.id },
            }),
        ).toBe(1)
    })

    it('decline removes the offer and leaves the person out of the club', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const person = await createUser(ctx, { email: 'bob@example.com' })
        const personActor = await signIn(ctx, person.email)
        const ownerActor = await signIn(ctx, owner.email)

        const added = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .send({ email: 'bob@example.com' })
            .expect(201)
        expect(added.body).toEqual({
            userId: person.id,
            email: 'bob@example.com',
            outcome: 'invited',
        })

        const [offer] = await myInvitations(personActor)
        await ctx
            .http()
            .post(`/me/invitations/${offer.id}/decline`)
            .set(...personActor.auth)
            .expect(201)
        expect(await myInvitations(personActor)).toEqual([])
        expect(await myClubs(personActor)).not.toContain(workspace.id)
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: person.id, workspaceId: workspace.id },
            }),
        ).toBe(0)
        // Declining again finds nothing.
        await ctx
            .http()
            .post(`/me/invitations/${offer.id}/decline`)
            .set(...personActor.auth)
            .expect(404)
    })

    it("nobody else can accept or decline someone's offer; the club can revoke it", async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const person = await createUser(ctx, { email: 'carl@example.com' })
        const ownerActor = await signIn(ctx, owner.email)
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/invite`)
            .set(...ownerActor.auth)
            .send({ email: person.email, role: 'user', sendEmail: false })
            .expect(201)
        const offer = await ctx.prisma.workspaceInvitation.findFirstOrThrow({
            where: { userId: person.id },
        })

        const stranger = await signIn(ctx, 'stranger@example.com')
        await ctx
            .http()
            .post(`/me/invitations/${offer.id}/accept`)
            .set(...stranger.auth)
            .expect(404)
        await ctx
            .http()
            .post(`/me/invitations/${offer.id}/decline`)
            .set(...stranger.auth)
            .expect(404)

        // A plain member of the club cannot see or revoke offers.
        const { user: member } = await addMember(ctx, { workspaceId: workspace.id })
        const memberActor = await signIn(ctx, member.email)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/invitations`)
            .set(...memberActor.auth)
            .expect(403)

        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/invitations/${offer.id}`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(await ctx.prisma.workspaceInvitation.count()).toBe(0)
    })

    it('a brand-new e-mail is still added straight away', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        const res = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .send({ email: 'fresh@example.com' })
            .expect(201)
        expect(res.body.outcome).toBe('added')
        expect(res.body).not.toHaveProperty('isNew')
        const fresh = await signIn(ctx, 'fresh@example.com')
        expect(await myClubs(fresh)).toContain(workspace.id)
    })

    it('entering the club code accepts a waiting offer', async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Code Club' })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: workspace.id, code: 'ABCD2345' },
        })
        const person = await createUser(ctx, { email: 'dan@example.com', firstname: 'Dan' })
        const ownerActor = await signIn(ctx, owner.email)
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/invite`)
            .set(...ownerActor.auth)
            .send({ email: person.email, role: 'user' })
            .expect(201)
            .expect((r) => {
                expect(r.body.outcome).toBe('invited')
            })

        const personActor = await signIn(ctx, person.email)
        const joined = await ctx
            .http()
            .post('/workspaces/join')
            .set(...personActor.auth)
            .send({ code: 'ABCD-2345' })
            .expect(201)
        expect(joined.body).toMatchObject({ status: 'active', workspaceId: workspace.id })
        expect(await myClubs(personActor)).toContain(workspace.id)
        expect(await myInvitations(personActor)).toEqual([])
    })
})
