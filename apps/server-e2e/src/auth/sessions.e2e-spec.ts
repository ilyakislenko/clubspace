import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { clearResendCooldown, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Token types, rotation and session revocation, end to end: through the real
// AuthGuard, the real refresh endpoint and the real database rows.
describe('sessions', () => {
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

    const refresh = (refreshToken: string) =>
        ctx.http().post('/refresh-token').send({ refreshToken })

    // Both kinds are signed with the same secret; before the `typ` claim a
    // 30-day refresh token was a perfectly good access token.
    it('refuses a refresh token used as an access token', async () => {
        const actor = await signIn(ctx, 'member@example.com')

        await ctx
            .http()
            .get('/me')
            .set('Authorization', `Bearer ${actor.refreshToken}`)
            .expect(401)
        // …while the access token of the same sign-in works.
        await ctx.http().get('/me').set(...actor.auth).expect(200)
    })

    it('refuses an access token presented to the refresh endpoint', async () => {
        const actor = await signIn(ctx, 'member@example.com')
        await refresh(actor.accessToken).expect(401)
    })

    it('rotates a refresh token into a working pair', async () => {
        const actor = await signIn(ctx, 'member@example.com')

        const res = await refresh(actor.refreshToken).expect(201)

        expect(res.body.refreshToken).not.toBe(actor.refreshToken)
        await ctx
            .http()
            .get('/me')
            .set('Authorization', `Bearer ${res.body.accessToken}`)
            .expect(200)
    })

    // A rotated token showing up again means two parties hold it. The server
    // can't tell which one is the thief, so every token of that sign-in dies.
    it('kills the whole token family when a rotated refresh token is reused', async () => {
        const actor = await signIn(ctx, 'member@example.com')
        const rotated = await refresh(actor.refreshToken).expect(201)

        await refresh(actor.refreshToken).expect(401)

        // The legitimately rotated token went down with the family.
        await refresh(rotated.body.refreshToken).expect(401)
        const live = await ctx.prisma.refreshToken.count({
            where: { userId: actor.userId, isRevoked: false },
        })
        expect(live).toBe(0)
    })

    it('lets exactly one of two concurrent refreshes with one token win', async () => {
        const actor = await signIn(ctx, 'member@example.com')

        const results = await Promise.all([
            refresh(actor.refreshToken),
            refresh(actor.refreshToken),
        ])

        expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(1)
        expect(results.some((r) => r.status === 401)).toBe(true)
    })

    it('leaves other devices alone when one device signs out', async () => {
        const phone = await signIn(ctx, 'member@example.com')
        await clearResendCooldown(ctx, 'member@example.com')
        ctx.mail.clear()
        const laptop = await signIn(ctx, 'member@example.com')

        await ctx
            .http()
            .post('/sign-out')
            .send({ refreshToken: phone.refreshToken })
            .expect(201)

        await refresh(phone.refreshToken).expect(401)
        await refresh(laptop.refreshToken).expect(201)
    })

    it('ends every session, access tokens included, on sign out everywhere', async () => {
        const phone = await signIn(ctx, 'member@example.com')
        await clearResendCooldown(ctx, 'member@example.com')
        ctx.mail.clear()
        const laptop = await signIn(ctx, 'member@example.com')

        await ctx
            .http()
            .post('/me/sign-out-everywhere')
            .set(...phone.auth)
            .expect(200, { status: 'signed-out' })

        // Still inside their 15-minute lifetime, yet both are refused.
        await ctx.http().get('/me').set(...phone.auth).expect(401)
        await ctx.http().get('/me').set(...laptop.auth).expect(401)
        await refresh(phone.refreshToken).expect(401)
        await refresh(laptop.refreshToken).expect(401)

        // Signing in again works as usual.
        await clearResendCooldown(ctx, 'member@example.com')
        ctx.mail.clear()
        const again = await signIn(ctx, 'member@example.com')
        await ctx.http().get('/me').set(...again.auth).expect(200)
    })

    it('needs a valid session to sign out everywhere', async () => {
        await ctx.http().post('/me/sign-out-everywhere').expect(401)
    })
})

// A head coach runs coaches and students; the admin tier is the owner's to
// hand out.
describe('role hierarchy', () => {
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

    const roleId = async (name: string) =>
        (await ctx.prisma.role.findUniqueOrThrow({ where: { name } })).id

    const setRole = (
        actor: { auth: [string, string] },
        workspaceId: string,
        userId: string,
        roleName: string,
    ) =>
        roleId(roleName).then((id) =>
            ctx
                .http()
                .patch(`/workspaces/${workspaceId}/members/${userId}/role`)
                .set(...actor.auth)
                .send({ roleId: id }),
        )

    const setUp = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: headCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        const { user: student } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        return { workspace, owner, headCoach, student }
    }

    it('refuses a head coach granting admin', async () => {
        const { workspace, headCoach, student } = await setUp()
        const actor = await signIn(ctx, headCoach.email)

        const res = await setRole(actor, workspace.id, student.id, 'admin')

        expect(res.status).toBe(403)
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: workspace.id, userId: student.id },
            include: { role: true },
        })
        expect(member.role.name).toBe('user')
    })

    it('refuses a head coach removing an admin', async () => {
        const { workspace, headCoach } = await setUp()
        const { user: admin } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.ADMIN,
        })
        const actor = await signIn(ctx, headCoach.email)

        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/members/${admin.id}`)
            .set(...actor.auth)
            .expect(403)
    })

    it('lets a head coach make a student a coach', async () => {
        const { workspace, headCoach, student } = await setUp()
        const actor = await signIn(ctx, headCoach.email)

        const res = await setRole(actor, workspace.id, student.id, 'coach')

        expect(res.status).toBe(200)
        expect(res.body.roleName).toBe('coach')
    })

    it('lets the owner grant admin', async () => {
        const { workspace, owner, student } = await setUp()
        const actor = await signIn(ctx, owner.email)

        const res = await setRole(actor, workspace.id, student.id, 'admin')

        expect(res.status).toBe(200)
        expect(res.body.roleName).toBe('admin')
    })
})
