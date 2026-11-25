import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

// Ladder standards (docs/design/2026-11-26-federation-hub-mvp.md §3.3): a club
// takes a federation template as a copy with provenance, then edits it freely.
describe('federation ladder template', () => {
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
    })

    const http = () => ctx.http()

    it('club adopts a ladder template as an editable copy', async () => {
        const org = await createOrganization(ctx, { name: 'Федерация БЖЖ' })
        const orgCoachUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: orgCoachUser.id, role: 'ORG_COACH' })
        const orgCoach = await signIn(ctx, orgCoachUser.email!)
        const { workspace } = await createWorkspace(ctx, { name: 'ACADEMY' })
        await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id })
        const headUser = await createUser(ctx)
        await addMember(ctx, { workspaceId: workspace.id, userId: headUser.id, role: RolesEnum.HEAD_COACH })
        const head = await signIn(ctx, headUser.email!)
        const studentUser = await createUser(ctx)
        await addMember(ctx, { workspaceId: workspace.id, userId: studentUser.id })
        const student = await signIn(ctx, studentUser.email!)
        const w = workspace.id

        // The org team publishes a standard and adds a rung (version 1 → 2).
        const created = (
            await http()
                .post(`/orgs/${org.id}/ladder-templates`)
                .set(...orgCoach.auth)
                .send({
                    name: 'Пояса (взрослые)',
                    audience: 'adult',
                    levels: [
                        { name: 'Белый', order: 0, color: '#ffffff', maxStripes: 4 },
                        { name: 'Синий', order: 1, color: '#1e40af', maxStripes: 4, minVisits: 100 },
                    ],
                })
                .expect(201)
        ).body
        expect(created).toMatchObject({ version: 1, adoptions: [] })
        const v2 = (
            await http()
                .post(`/orgs/${org.id}/ladder-templates/${created.id}/levels`)
                .set(...orgCoach.auth)
                .send({ name: 'Фиолетовый', order: 2, color: '#7e22ce', maxStripes: 4 })
                .expect(201)
        ).body
        expect(v2.version).toBe(2)
        await http()
            .post(`/orgs/${org.id}/ladder-templates/${created.id}/levels`)
            .set(...orgCoach.auth)
            .send({ name: 'Дубль', order: 2 })
            .expect(409)

        // The club sees it under «Стандарты федерации»; a student may not.
        const adoptable = (
            await http().get(`/workspaces/${w}/organization-ladder-templates`).set(...head.auth).expect(200)
        ).body.data
        expect(adoptable).toEqual([
            expect.objectContaining({
                id: created.id,
                organizationName: 'Федерация БЖЖ',
                version: 2,
                adoptedLadders: [],
            }),
        ])
        expect(adoptable[0].levels.map((l: { name: string }) => l.name)).toEqual(['Белый', 'Синий', 'Фиолетовый'])
        await http().get(`/workspaces/${w}/organization-ladder-templates`).set(...student.auth).expect(403)

        // «Взять за основу»: a copy with provenance.
        const copy = (
            await http()
                .post(`/workspaces/${w}/rank-ladders/from-template`)
                .set(...head.auth)
                .send({ templateId: created.id })
                .expect(201)
        ).body
        expect(copy).toMatchObject({
            workspaceId: w,
            name: 'Пояса (взрослые)',
            audience: 'adult',
            templateId: created.id,
            templateVersion: 2,
        })
        expect(copy.levels.map((l: { name: string; minVisits: number | null }) => [l.name, l.minVisits])).toEqual([
            ['Белый', null],
            ['Синий', 100],
            ['Фиолетовый', null],
        ])
        const stored = await ctx.prisma.rankLevel.findMany({
            where: { ladderId: copy.id },
            orderBy: { order: 'asc' },
            select: { templateLevelId: true },
        })
        expect(stored.map((l) => l.templateLevelId)).toEqual(v2.levels.map((l: { id: string }) => l.id))
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'ladder.fromTemplate' } })
        expect(audit).toMatchObject({ workspaceId: w, organizationId: org.id, targetId: copy.id })

        // The club edits its copy; the standard does not move.
        const blue = copy.levels[1]
        await http()
            .patch(`/workspaces/${w}/rank-ladders/${copy.id}/levels/${blue.id}`)
            .set(...head.auth)
            .send({ name: 'Синий (клуб)', maxStripes: 2 })
            .expect(200)
        const tpl = (
            await http().get(`/orgs/${org.id}/ladder-templates`).set(...orgCoach.auth).expect(200)
        ).body.data[0]
        expect(tpl.levels[1]).toMatchObject({ name: 'Синий', maxStripes: 4 })
        expect(tpl.adoptions).toEqual([{ clubId: w, clubName: 'ACADEMY', version: 2 }])

        // The org edits the standard; the copy stays, the club is told it is behind.
        const v3 = (
            await http()
                .patch(`/orgs/${org.id}/ladder-templates/${created.id}/levels/${v2.levels[0].id}`)
                .set(...orgCoach.auth)
                .send({ requirements: 'Базовые техники' })
                .expect(200)
        ).body
        expect(v3.version).toBe(3)
        const ladders = (await http().get(`/workspaces/${w}/rank-ladders`).set(...head.auth).expect(200)).body
        const mine = ladders.data.find((l: { id: string }) => l.id === copy.id)
        expect(mine).toMatchObject({ templateId: created.id, templateVersion: 2 })
        expect(mine.levels[0].requirements).toBeNull()
        expect(mine.levels[1]).toMatchObject({ name: 'Синий (клуб)', maxStripes: 2 })
        expect(ladders.templates).toEqual([
            { id: created.id, name: 'Пояса (взрослые)', organizationName: 'Федерация БЖЖ', version: 3 },
        ])

        // A club outside the federation can't adopt it.
        const { workspace: other, owner: otherOwner } = await createWorkspace(ctx, { name: 'Ритм' })
        const otherActor = await signIn(ctx, otherOwner.email!)
        await http()
            .post(`/workspaces/${other.id}/rank-ladders/from-template`)
            .set(...otherActor.auth)
            .send({ templateId: created.id })
            .expect(404)
    })
})
