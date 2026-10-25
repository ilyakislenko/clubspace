import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createGroupWithSlot, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// An admin invites by e-mail with a role and a group in one step: the invitee
// is an ACTIVE member straight away, gets the e-mail, signs in and sees the
// club without ever typing a code.
describe('invite a member by e-mail', () => {
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

    const invite = (
        actor: { auth: [string, string] },
        workspaceId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/invite`)
            .set(...actor.auth)
            .send(body)

    it('adds a coach to a group, e-mails them, and the club shows up after sign-in', async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            name: 'Tomsk Club',
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek: 2,
            name: 'Kids',
        })
        const ownerActor = await signIn(ctx, owner.email)
        ctx.mail.clear()

        const res = await invite(ownerActor, workspace.id, {
            email: 'Coach@Example.com',
            firstname: 'Ann',
            lastname: 'Lee',
            role: 'coach',
            groupId: group.id,
        }).expect(201)
        expect(res.body).toMatchObject({
            email: 'coach@example.com',
            roleName: 'coach',
            outcome: 'added',
            isNewUser: true,
            emailSent: true,
            groupId: group.id,
        })

        const mail = await ctx.mail.waitFor(
            (m) => m.to === 'coach@example.com' && m.html.includes('Tomsk Club'),
        )
        expect(mail.html).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/)

        expect(
            await ctx.prisma.groupCoach.count({
                where: { groupId: group.id, userId: res.body.userId },
            }),
        ).toBe(1)

        const coach = await signIn(ctx, 'coach@example.com')
        const mine = await ctx
            .http()
            .post('/get-my-workspaces')
            .set(...coach.auth)
            .send({})
            .expect(201)
        expect(JSON.stringify(mine.body)).toContain(workspace.id)
    })

    it('sends no e-mail when sendEmail is false', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        ctx.mail.clear()

        const res = await invite(ownerActor, workspace.id, {
            email: 'quiet@example.com',
            role: 'user',
            sendEmail: false,
        }).expect(201)
        expect(res.body.emailSent).toBe(false)
        expect(ctx.mail.sent.filter((m) => m.to === 'quiet@example.com')).toEqual(
            [],
        )
    })

    it('refuses a plain member and a coach', async () => {
        const { workspace } = await createWorkspace(ctx)
        for (const role of [RolesEnum.USER, RolesEnum.COACH]) {
            const { user } = await addMember(ctx, {
                workspaceId: workspace.id,
                role,
            })
            const actor = await signIn(ctx, user.email)
            await invite(actor, workspace.id, {
                email: 'x@example.com',
                role: 'user',
            }).expect(403)
        }
    })
})
