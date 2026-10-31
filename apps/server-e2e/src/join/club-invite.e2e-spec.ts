import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// One application per spec file, like every other suite: a second
// createTestApp() in the same file (same module registry) left the second
// app.close() hanging past the hook timeout.
describe('club invite (code, QR, rotation)', () => {
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

    it('makes the code on first read and lets staff, not members, see it', async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        const coach = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const student = await addMember(ctx, { workspaceId: workspace.id })

        const ownerActor = await signIn(ctx, owner.email)
        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/invite`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(res.body.joinCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
        expect(res.body.joinCodeDisplay).toBe(
            `${res.body.joinCode.slice(0, 4)}-${res.body.joinCode.slice(4)}`,
        )
        expect(res.body.joinUrl).toBe(
            `http://localhost:8081/join/${res.body.joinCode}`,
        )
        expect(res.body.qrPngDataUrl).toMatch(/^data:image\/png;base64,/)

        const coachActor = await signIn(ctx, coach.user.email)
        const asCoach = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/invite`)
            .set(...coachActor.auth)
            .expect(200)
        expect(asCoach.body.joinCode).toBe(res.body.joinCode)

        const studentActor = await signIn(ctx, student.user.email)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/invite`)
            .set(...studentActor.auth)
            .expect(403)
    })

    it('rotation is admin-only and kills the old code', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const coach = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const before = (
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/invite`)
                .set(...ownerActor.auth)
                .expect(200)
        ).body.joinCode

        const coachActor = await signIn(ctx, coach.user.email)
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/invite/rotate-code`)
            .set(...coachActor.auth)
            .expect(403)

        const rotated = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/invite/rotate-code`)
            .set(...ownerActor.auth)
            .expect(201)
        expect(rotated.body.joinCode).not.toBe(before)

        const joiner = await signIn(ctx, 'newbie@example.com')
        await ctx
            .http()
            .post('/workspaces/join')
            .set(...joiner.auth)
            .send({ code: before, firstname: 'A', lastname: 'B' })
            .expect(404)
        await ctx
            .http()
            .post('/workspaces/join')
            .set(...joiner.auth)
            .send({ code: rotated.body.joinCode, firstname: 'A', lastname: 'B' })
            .expect(201)

        const audit = await ctx.prisma.auditEvent.findMany({
            where: { action: 'workspace.rotateJoinCode' },
        })
        expect(audit).toHaveLength(1)
        expect(JSON.stringify(audit[0])).not.toContain(rotated.body.joinCode)
    })
})
