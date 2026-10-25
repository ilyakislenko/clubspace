import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'

describe('club about page', () => {
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

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        const { user: student } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        return {
            workspace,
            ownerActor,
            studentActor: await signIn(ctx, student.email),
            coachActor: await signIn(ctx, coach.email),
        }
    }

    const body = {
        contacts: [{ label: 'Главный тренер', phone: '8-952-884-94-20' }],
        links: [{ label: 'Сайт', url: 'https://club.example' }],
        rules: 'Приходить вовремя',
    }

    it('lets a member read the defaults of an unfilled club', async () => {
        const { workspace, studentActor } = await setup()

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...studentActor.auth)
            .expect(200)

        expect(res.body).toEqual({
            contacts: [],
            links: [],
            rules: null,
            updatedAt: null,
        })
    })

    it('refuses a coach writing the page', async () => {
        const { workspace, coachActor } = await setup()

        await ctx
            .http()
            .put(`/workspaces/${workspace.id}/about`)
            .set(...coachActor.auth)
            .send(body)
            .expect(403)
    })

    it('stores a normalized phone and shows it to students', async () => {
        const { workspace, ownerActor, studentActor } = await setup()

        const put = await ctx
            .http()
            .put(`/workspaces/${workspace.id}/about`)
            .set(...ownerActor.auth)
            .send(body)
        expect(put.status).toBe(200)
        expect(put.body.contacts).toEqual([
            { label: 'Главный тренер', phone: '+79528849420' },
        ])

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...studentActor.auth)
            .expect(200)
        expect(res.body.contacts[0].phone).toBe('+79528849420')
        expect(res.body.rules).toBe('Приходить вовремя')
        expect(res.body.updatedAt).not.toBeNull()
    })

    it('rejects a non-http link with 400', async () => {
        const { workspace, ownerActor } = await setup()

        const res = await ctx
            .http()
            .put(`/workspaces/${workspace.id}/about`)
            .set(...ownerActor.auth)
            .send({
                ...body,
                links: [{ label: 'x', url: 'javascript:alert(1)' }],
            })

        expect(res.status).toBe(400)
    })
})
