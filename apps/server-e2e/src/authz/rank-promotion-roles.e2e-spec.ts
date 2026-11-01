import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { Actor, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Belts are the club's credential: only the head coach and the club admin may
// award them. A student must not promote anyone (themselves included), and an
// ordinary coach marks attendance but does not grade.
describe('who may promote ranks', () => {
    let ctx: TestApp
    let workspaceId: string
    let owner: Actor
    let studentId: string
    let ladderId: string
    let levelIds: string[]

    beforeAll(async () => {
        ctx = await createTestApp()
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        const { workspace, owner: ownerUser } = await createWorkspace(ctx)
        workspaceId = workspace.id
        owner = await signIn(ctx, ownerUser.email)
        studentId = (await addMember(ctx, { workspaceId })).user.id

        const ladder = await ctx
            .http()
            .post(`/workspaces/${workspaceId}/rank-ladders`)
            .set(...owner.auth)
            .send({ name: 'BJJ' })
            .expect(201)
        ladderId = ladder.body.id
        levelIds = []
        for (const [order, name] of ['Белый', 'Синий'].entries()) {
            const level = await ctx
                .http()
                .post(`/workspaces/${workspaceId}/rank-ladders/${ladderId}/levels`)
                .set(...owner.auth)
                .send({ name, order })
                .expect(201)
            levelIds.push(level.body.id)
        }
    })
    afterAll(async () => {
        await ctx?.close()
    })

    // A grading with a fresh student as its candidate (one open grading per
    // member and ladder), set up by the owner, so the results call is refused
    // or accepted on the caller's role alone.
    const gradingWithCandidate = async () => {
        const candidate = (await addMember(ctx, { workspaceId })).user.id
        const grading = await ctx
            .http()
            .post(`/workspaces/${workspaceId}/rank-gradings`)
            .set(...owner.auth)
            .send({ ladderId, date: '2026-12-01' })
            .expect(201)
        const withCandidate = await ctx
            .http()
            .post(`/workspaces/${workspaceId}/rank-gradings/${grading.body.id}/candidates`)
            .set(...owner.auth)
            .send({ userIds: [candidate], levelId: levelIds[1] })
            .expect(201)
        return {
            gradingId: grading.body.id as string,
            candidateId: withCandidate.body.candidates[0].id as string,
        }
    }

    const attempts = async (actor: Actor) => {
        const { gradingId, candidateId } = await gradingWithCandidate()
        const http = () => ctx.http()
        const base = `/workspaces/${workspaceId}`
        return {
            promoteMember: await http()
                .post(`${base}/members/${studentId}/rank`)
                .set(...actor.auth)
                .send({ ladderId, levelId: levelIds[1] }),
            promoteMembers: await http()
                .post(`${base}/rank-ladders/${ladderId}/promotions`)
                .set(...actor.auth)
                .send({ userIds: [studentId], levelId: levelIds[0] }),
            createGrading: await http()
                .post(`${base}/rank-gradings`)
                .set(...actor.auth)
                .send({ ladderId, date: '2026-12-15' }),
            gradingResults: await http()
                .post(`${base}/rank-gradings/${gradingId}/results`)
                .set(...actor.auth)
                .send({ results: [{ candidateId, result: 'PASSED' }] }),
            editLevel: await http()
                .patch(`${base}/rank-ladders/${ladderId}/levels/${levelIds[0]}`)
                .set(...actor.auth)
                .send({ requirements: 'Отработать базу' }),
        }
    }

    const memberActor = async (role: RolesEnum) => {
        const { user } = await addMember(ctx, { workspaceId, role })
        return await signIn(ctx, user.email!)
    }

    it.each([
        ['a student', RolesEnum.USER],
        ['an ordinary coach', RolesEnum.COACH],
    ])('refuses %s every promotion route', async (_label, role) => {
        const actor = await memberActor(role)
        const results = await attempts(actor)
        for (const [route, res] of Object.entries(results)) {
            expect({ route, status: res.status }).toEqual({ route, status: 403 })
        }
    })

    it('refuses a student promoting themselves', async () => {
        const student = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: studentId },
        })
        const actor = await signIn(ctx, student.email!)
        const res = await ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/${studentId}/rank`)
            .set(...actor.auth)
            .send({ ladderId, levelId: levelIds[1] })
        expect(res.status).toBe(403)
    })

    it.each([
        ['the head coach', RolesEnum.HEAD_COACH],
        ['a club admin', RolesEnum.ADMIN],
    ])('lets %s use every promotion route', async (_label, role) => {
        const actor = await memberActor(role)
        const results = await attempts(actor)
        for (const [route, res] of Object.entries(results)) {
            expect({ route, ok: res.status >= 200 && res.status < 300 }).toEqual({
                route,
                ok: true,
            })
        }
    })
})
