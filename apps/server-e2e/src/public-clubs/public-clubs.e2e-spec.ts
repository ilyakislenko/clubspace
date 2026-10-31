import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'

const CODE = 'TSKC2345'

// Ids are what would let a stranger reach the authenticated endpoints; the
// public payload must not carry a single one, at any depth.
const collectKeys = (value: unknown, keys = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => collectKeys(v, keys))
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            keys.add(k)
            collectKeys(v, keys)
        }
    }
    return keys
}

describe('public club pages', () => {
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

    const setup = async (name = 'Академия БЖЖ') => {
        const { workspace, owner } = await createWorkspace(ctx, { name })
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: {
                city: 'Томск',
                publicDescription: 'Зал у реки',
                aboutContacts: [{ label: 'Тренер', phone: '+79528849420' }],
                aboutLinks: [{ label: 'Сайт', url: 'https://club.example' }],
            },
        })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek: 2,
            startTime: '19:30',
            name: 'Взрослые',
        })
        const ownerActor = await signIn(ctx, owner.email)
        return { workspace, owner, coach, ownerActor }
    }

    const saveProfile = (
        actor: { auth: [string, string] },
        workspaceId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .put(`/workspaces/${workspaceId}/public-profile`)
            .set(...actor.auth)
            .send({
                slug: 'akademiya-bzhzh',
                city: 'Томск',
                description: 'Зал у реки',
                logoKey: null,
                isListed: true,
                ...body,
            })

    describe('GET /public/clubs/by-code/:code', () => {
        it('previews an unlisted club to anyone holding its code', async () => {
            const { workspace, coach } = await setup()
            await ctx.prisma.workspaceJoinCode.create({
                data: { workspaceId: workspace.id, code: CODE },
            })

            const res = await ctx
                .http()
                .get('/public/clubs/by-code/tskc-2345')
                .expect(200)

            expect(res.body).toEqual({
                name: 'Академия БЖЖ',
                type: 'GRAPPLING',
                slug: null,
                logoUrl: null,
                description: 'Зал у реки',
                city: 'Томск',
                gyms: [{ name: 'Test Gym', address: 'Test street 1' }],
                schedule: [
                    {
                        group: 'Взрослые',
                        gym: 'Test Gym',
                        timezone: 'Asia/Tomsk',
                        slots: [
                            { dayOfWeek: 2, startTime: '19:30', durationMin: 90 },
                        ],
                    },
                ],
                contacts: [{ label: 'Тренер', phone: '+79528849420' }],
                links: [{ label: 'Сайт', url: 'https://club.example' }],
                joinCode: CODE,
                joinCodeDisplay: 'TSKC-2345',
            })
            const keys = collectKeys(res.body)
            for (const forbidden of ['id', 'workspaceId', 'ownerId', 'coachId', 'userId', 'email']) {
                expect(keys.has(forbidden)).toBe(false)
            }
            expect(JSON.stringify(res.body)).not.toContain(workspace.id)
            expect(JSON.stringify(res.body)).not.toContain(coach.email)
        })

        it('404s for a deactivated club', async () => {
            const { workspace } = await setup()
            await ctx.prisma.workspaceJoinCode.create({
                data: { workspaceId: workspace.id, code: CODE },
            })
            await ctx.prisma.workspace.update({
                where: { id: workspace.id },
                data: { isActive: false },
            })
            await ctx.http().get(`/public/clubs/by-code/${CODE}`).expect(404)
        })

        it('404s for a code rotated away, an unknown and a malformed one', async () => {
            const { workspace, ownerActor } = await setup()
            await ctx.prisma.workspaceJoinCode.create({
                data: { workspaceId: workspace.id, code: CODE },
            })
            const rotated = await ctx
                .http()
                .post(`/workspaces/${workspace.id}/invite/rotate-code`)
                .set(...ownerActor.auth)
                .expect(201)
            expect(rotated.body.joinCode).not.toBe(CODE)

            await ctx
                .http()
                .get(`/public/clubs/by-code/${rotated.body.joinCode}`)
                .expect(200)
            await ctx.http().get(`/public/clubs/by-code/${CODE}`).expect(404)
            await ctx.http().get('/public/clubs/by-code/ZZZZ9999').expect(404)
            await ctx.http().get('/public/clubs/by-code/nope').expect(404)
        })
    })

    describe('club admin «Публичная страница»', () => {
        it('generates the slug and the preview links on first view', async () => {
            const { workspace, ownerActor } = await setup()
            const res = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/public-profile`)
                .set(...ownerActor.auth)
                .expect(200)
            expect(res.body).toMatchObject({
                slug: 'akademiya-bzhzh',
                city: 'Томск',
                description: 'Зал у реки',
                logoUrl: null,
                isListed: false,
                pageUrl: expect.stringMatching(/\/c\/akademiya-bzhzh$/),
                joinPageUrl: expect.stringMatching(/\/join\/[2-9A-Z]{8}$/),
            })
        })

        it('refuses a coach', async () => {
            const { workspace, coach } = await setup()
            const coachActor = await signIn(ctx, coach.email)
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/public-profile`)
                .set(...coachActor.auth)
                .expect(403)
            await saveProfile(coachActor, workspace.id, {}).expect(403)
            await ctx
                .http()
                .post(`/workspaces/${workspace.id}/public-profile/logo-upload`)
                .set(...coachActor.auth)
                .send({ contentType: 'image/png', contentLength: 100 })
                .expect(403)
        })

        it('issues a logo upload under the club prefix and refuses a foreign key', async () => {
            const { workspace, ownerActor } = await setup()
            const upload = await ctx
                .http()
                .post(`/workspaces/${workspace.id}/public-profile/logo-upload`)
                .set(...ownerActor.auth)
                .send({ contentType: 'image/png', contentLength: 1000 })
                .expect(201)
            expect(upload.body.key).toMatch(
                new RegExp(`^workspaces/${workspace.id}/logo/[0-9a-f-]{36}$`),
            )
            expect(upload.body.upload.method).toBe('PUT')

            await saveProfile(ownerActor, workspace.id, {
                logoKey: 'thumbnails/someone-else.png',
            }).expect(400)

            const saved = await saveProfile(ownerActor, workspace.id, {
                logoKey: upload.body.key,
            }).expect(200)
            expect(saved.body.logoKey).toBe(upload.body.key)
            expect(saved.body.logoUrl).toContain(upload.body.key)
        })

        it('refuses a slug another club already has', async () => {
            const first = await setup()
            await saveProfile(first.ownerActor, first.workspace.id, {
                slug: 'tomsk-club',
            }).expect(200)

            const { workspace, owner } = await createWorkspace(ctx, {
                name: 'Другой клуб',
            })
            const other = await signIn(ctx, owner.email)
            const res = await saveProfile(other, workspace.id, {
                slug: 'tomsk-club',
            }).expect(400)
            expect(res.body.message).toContain('уже занят')
        })
    })

    describe('GET /public/clubs/:slug and search', () => {
        it('shows a listed club with its join code, and 404s once it is unlisted', async () => {
            const { workspace, ownerActor } = await setup()
            await saveProfile(ownerActor, workspace.id, {}).expect(200)

            const res = await ctx
                .http()
                .get('/public/clubs/akademiya-bzhzh')
                .expect(200)
            expect(res.body).toMatchObject({
                name: 'Академия БЖЖ',
                slug: 'akademiya-bzhzh',
                city: 'Томск',
                joinCode: expect.stringMatching(/^[2-9A-Z]{8}$/),
            })

            await saveProfile(ownerActor, workspace.id, {
                isListed: false,
            }).expect(200)
            await ctx.http().get('/public/clubs/akademiya-bzhzh').expect(404)
            await ctx.http().get('/public/clubs/no-such-club').expect(404)
        })

        it('finds listed clubs only, by text, city and type', async () => {
            const listed = await setup('Академия БЖЖ')
            await saveProfile(listed.ownerActor, listed.workspace.id, {}).expect(200)

            // An unlisted club in the same city: never in the results, even
            // when the query names it exactly.
            const hidden = await createWorkspace(ctx, { name: 'Скрытый клуб' })
            await ctx.prisma.workspace.update({
                where: { id: hidden.workspace.id },
                data: { city: 'Томск' },
            })
            const hiddenOwner = await signIn(ctx, hidden.owner.email)
            await ctx
                .http()
                .get(`/workspaces/${hidden.workspace.id}/public-profile`)
                .set(...hiddenOwner.auth)
                .expect(200)

            const all = await ctx.http().get('/public/clubs').expect(200)
            expect(all.body).toMatchObject({
                total: 1,
                curPage: 1,
                perPage: 20,
                cities: ['Томск'],
            })
            expect(all.body.data).toEqual([
                {
                    slug: 'akademiya-bzhzh',
                    name: 'Академия БЖЖ',
                    type: 'GRAPPLING',
                    city: 'Томск',
                    description: 'Зал у реки',
                    logoUrl: null,
                },
            ])

            const byName = await ctx
                .http()
                .get('/public/clubs')
                .query({ q: 'скрытый' })
                .expect(200)
            expect(byName.body.total).toBe(0)

            const byCity = await ctx
                .http()
                .get('/public/clubs')
                .query({ q: 'акад', city: 'томск', type: 'GRAPPLING' })
                .expect(200)
            expect(byCity.body.total).toBe(1)

            const otherType = await ctx
                .http()
                .get('/public/clubs')
                .query({ type: 'YOGA' })
                .expect(200)
            expect(otherType.body.total).toBe(0)

            await ctx
                .http()
                .get('/public/clubs')
                .query({ perPage: 500 })
                .expect(400)
        })
    })
})
