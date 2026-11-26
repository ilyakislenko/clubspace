import * as fs from 'fs'
import * as path from 'path'

import { signIn, type Actor } from '../support/actors'
import { addMember, createUser } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import {
    actorFor,
    addOrgStaff,
    createDivisions,
    createOrganization,
    seedEntrant,
    setupTournament,
    type TournamentSetup,
} from './org-fixtures'

// Results (docs/design/2026-11-27-tournaments.md §2.1, §2.3, §5.1, §5.2):
// the org admin publishes once every division is finished; published podiums
// reach the registry and «Мои пояса» only with the tournament edition of the
// consent; members of other clubs see brackets without weights, birth years
// or hidden names.
type Competitor = { entryId: string; hidden: boolean; personName: string | null; clubName: string | null }
type Match = { id: string; round: number; position: number; entryA: Competitor | null; entryB: Competitor | null; updatedAt: string }

describe('tournament results', () => {
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
    const base = (s: TournamentSetup) => `/orgs/${s.org.id}/tournaments/${s.tournament.id}`
    const setStatus = (s: TournamentSetup, status: string) =>
        http().post(`${base(s)}/status`).set(...s.secretary.auth).send({ status }).expect(201)
    const orgMatches = async (s: TournamentSetup, divisionId: string): Promise<Match[]> =>
        (await http().get(`${base(s)}/divisions/${divisionId}/bracket`).set(...s.secretary.auth).expect(200)).body
            .matches
    // Decides the division's only match for `winnerEntryId`.
    const decide = async (s: TournamentSetup, divisionId: string, winnerEntryId: string) => {
        const [m] = await orgMatches(s, divisionId)
        await http()
            .post(`${base(s)}/matches/${m.id}/result`)
            .set(...s.secretary.auth)
            .send({ winnerEntryId, method: 'POINTS', scoreA: 2, scoreB: 0, expectedUpdatedAt: m.updatedAt })
            .expect(201)
        return m
    }
    const publish = (s: TournamentSetup, actor: Actor, published: boolean) =>
        http().post(`${base(s)}/publication`).set(...actor.auth).send({ published })

    // ACADEMY's ladder is a copy of the federation standard and Иванов holds
    // its blue belt, so the registry lists him.
    const withRegistryBelt = async (s: TournamentSetup, userId: string) => {
        const standard = await ctx.prisma.organizationLadderTemplate.create({
            data: {
                organizationId: s.org.id,
                name: 'Пояса (взрослые)',
                version: 1,
                levels: { create: [{ name: 'Синий', order: 1, maxStripes: 4 }] },
            },
            include: { levels: true },
        })
        const ladder = await ctx.prisma.rankLadder.create({
            data: { workspaceId: s.academy.workspace.id, name: 'Пояса (взрослые)', templateId: standard.id, templateVersion: 1 },
        })
        const blue = await ctx.prisma.rankLevel.create({
            data: { ladderId: ladder.id, name: 'Синий пояс', order: 1, maxStripes: 4, templateLevelId: standard.levels[0].id },
        })
        await ctx.prisma.rankPromotion.create({
            data: {
                workspaceId: s.academy.workspace.id,
                userId,
                ladderId: ladder.id,
                levelId: blue.id,
                stripes: 0,
                awardedById: s.academy.owner.id,
                awardedAt: new Date('2026-01-10T05:00:00Z'),
            },
        })
    }

    // Two divisions of two: Иванов (ACADEMY) vs Петров (Беркут), and a heavy pair.
    const setup = async () => {
        const s = await setupTournament(ctx)
        const [light, heavy] = await createDivisions(ctx, s, [
            { sex: 'MALE', weightMaxKg: 76 },
            { sex: 'MALE', weightMinKg: 76 },
        ])
        const ivanov = await seedEntrant(ctx, s, { club: s.academy.workspace, firstname: 'Иван', lastname: 'Иванов', divisionId: light.id, weighedKg: 75 })
        const petrov = await seedEntrant(ctx, s, { club: s.berkut.workspace, firstname: 'Пётр', lastname: 'Петров', divisionId: light.id, weighedKg: 74 })
        const h1 = await seedEntrant(ctx, s, { club: s.academy.workspace, firstname: 'Борис', lastname: 'Тяжёлов', divisionId: heavy.id, weighedKg: 90 })
        await seedEntrant(ctx, s, { club: s.berkut.workspace, firstname: 'Глеб', lastname: 'Крупнов', divisionId: heavy.id, weighedKg: 88 })
        await setStatus(s, 'WEIGH_IN')
        await setStatus(s, 'RUNNING')
        return { ...s, light, heavy, ivanov, petrov, h1 }
    }

    it('publishing is admin-only and needs every division finished', async () => {
        const s = await setup()
        await decide(s, s.light.id, s.ivanov.entry.id)

        const coachTry = await publish(s, s.secretary, true).expect(403)
        expect(coachTry.body.statusCode).toBe(403)
        const early = await publish(s, s.orgAdmin, true).expect(400)
        expect(early.body.message).toBe('Не закончены: 1 категория')

        // Members see results only once published.
        const berkutMember = await actorFor(ctx, s.petrov.user)
        const clubResults = () =>
            http()
                .get(`/workspaces/${s.berkut.workspace.id}/org-events/${s.event.id}/tournament/results`)
                .set(...berkutMember.auth)
        await clubResults().expect(404)

        const heavyFinal = await decide(s, s.heavy.id, s.h1.entry.id)
        const published = (await publish(s, s.orgAdmin, true).expect(201)).body
        expect(published).toMatchObject({ status: 'FINISHED', resultsPublishedAt: expect.any(String) })
        expect((await clubResults().expect(200)).body.divisions).toEqual([
            expect.objectContaining({
                divisionId: s.light.id,
                podium: [
                    expect.objectContaining({ place: 1, personName: expect.stringContaining('Иванов'), isMyClub: false }),
                    expect.objectContaining({ place: 2, personName: expect.stringContaining('Петров'), isMe: true }),
                ],
            }),
            expect.objectContaining({ divisionId: s.heavy.id }),
        ])

        // After publication the tables change nothing: unpublish first.
        const late = await http()
            .post(`${base(s)}/matches/${heavyFinal.id}/undo`)
            .set(...s.secretary.auth)
            .send({})
            .expect(409)
        expect(late.body.code).toBe('TOURNAMENT_PUBLISHED')
        await publish(s, s.secretary, false).expect(403)
        expect((await publish(s, s.orgAdmin, false).expect(201)).body).toMatchObject({
            status: 'RUNNING',
            resultsPublishedAt: null,
        })
        await clubResults().expect(404)
        await http()
            .post(`${base(s)}/matches/${heavyFinal.id}/undo`)
            .set(...s.secretary.auth)
            .send({})
            .expect(201)
    })

    it('published podiums reach the registry and My ranks; withdrawn consent hides the name in brackets and the registry', async () => {
        const s = await setup()
        await withRegistryBelt(s, s.ivanov.user.id)
        await decide(s, s.light.id, s.ivanov.entry.id)
        await decide(s, s.heavy.id, s.h1.entry.id)

        const registryRow = async () =>
            (await http().get(`/orgs/${s.org.id}/registry`).set(...s.secretary.auth).expect(200)).body.data.find(
                (r: { personName: string }) => r.personName.includes('Иванов'),
            ) as { personKey: string; podiumCount: number } | undefined
        // Not published yet: no «призёр».
        expect((await registryRow())?.podiumCount).toBe(0)

        await publish(s, s.orgAdmin, true).expect(201)
        const row = await registryRow()
        expect(row?.podiumCount).toBe(1)
        const person = (
            await http().get(`/orgs/${s.org.id}/registry/${row!.personKey}`).set(...s.secretary.auth).expect(200)
        ).body
        expect(person.podiums).toEqual([
            { tournamentTitle: 'Кубок федерации', date: '2030-12-20', divisionName: s.light.name, place: 1 },
        ])

        // «Мои пояса» of the athlete.
        const ivan = await actorFor(ctx, s.ivanov.user)
        const myOrgs = async () =>
            (await http().get(`/workspaces/${s.academy.workspace.id}/me/organizations`).set(...ivan.auth).expect(200))
                .body.data[0]
        expect((await myOrgs()).podiums).toEqual([
            expect.objectContaining({ tournamentTitle: 'Кубок федерации', divisionName: s.light.name, place: 1 }),
        ])

        // Unpublishing hides the podium again.
        await publish(s, s.orgAdmin, false).expect(201)
        expect((await registryRow())?.podiumCount).toBe(0)
        expect((await myOrgs()).podiums).toEqual([])
        await publish(s, s.orgAdmin, true).expect(201)

        // Withdrawn consent: «Участник скрыт» in brackets everywhere, gone from the registry.
        await http()
            .put(`/workspaces/${s.academy.workspace.id}/me/organizations/${s.org.id}/consent`)
            .set(...ivan.auth)
            .send({ granted: false })
            .expect(200)
        expect(await registryRow()).toBeUndefined()
        await http().get(`/orgs/${s.org.id}/registry/${row!.personKey}`).set(...s.secretary.auth).expect(404)
        const [final] = await orgMatches(s, s.light.id)
        const hidden = [final.entryA, final.entryB].find((c) => c?.entryId === s.ivanov.entry.id)
        expect(hidden).toMatchObject({ hidden: true, personName: null, clubName: null })
        const berkutMember = await actorFor(ctx, s.petrov.user)
        const podium = (
            await http()
                .get(`/workspaces/${s.berkut.workspace.id}/org-events/${s.event.id}/tournament/results`)
                .set(...berkutMember.auth)
                .expect(200)
        ).body.divisions[0].podium
        expect(podium[0]).toMatchObject({ place: 1, hidden: true, personName: null, clubName: null })
        // The bracket keeps its shape and the result stays.
        expect(await ctx.prisma.tournamentEntry.findUniqueOrThrow({ where: { id: s.ivanov.entry.id } })).toMatchObject({ place: 1 })
        // Own data: «Мои пояса» still shows the podium.
        expect((await myOrgs()).podiums).toHaveLength(1)
    })

    it('a member of another federation club sees the bracket without weights or birth years', async () => {
        const s = await setupTournament(ctx)
        const [division] = await createDivisions(ctx, s, [{ sex: 'MALE', weightMaxKg: 76 }])
        const ivanov = await seedEntrant(ctx, s, { club: s.academy.workspace, firstname: 'Иван', lastname: 'Иванов', divisionId: division.id, weighedKg: 75 })
        // The hub's first consent edition: enough for the registry, not for names in brackets.
        const starov = await seedEntrant(ctx, s, {
            club: s.academy.workspace,
            firstname: 'Семён',
            lastname: 'Старов',
            divisionId: division.id,
            weighedKg: 73,
            consent: '2026-11-26.1',
        })
        const petrov = await seedEntrant(ctx, s, { club: s.berkut.workspace, firstname: 'Пётр', lastname: 'Петров', divisionId: division.id, weighedKg: 74 })
        await setStatus(s, 'WEIGH_IN')
        await setStatus(s, 'RUNNING')

        const viewerUser = await createUser(ctx, { firstname: 'Зритель' })
        await addMember(ctx, { workspaceId: s.berkut.workspace.id, userId: viewerUser.id })
        const viewer = await signIn(ctx, viewerUser.email!)
        const res = await http()
            .get(`/workspaces/${s.berkut.workspace.id}/org-events/${s.event.id}/tournament/divisions/${division.id}/bracket`)
            .set(...viewer.auth)
            .expect(200)

        // No weight, birth year, sex, level or user id anywhere in the payload.
        const keys: string[] = []
        const walk = (v: unknown) => {
            if (Array.isArray(v)) v.forEach(walk)
            else if (v && typeof v === 'object') {
                for (const [k, x] of Object.entries(v)) {
                    keys.push(k)
                    walk(x)
                }
            }
        }
        walk(res.body)
        expect(keys.filter((k) => /weight|birth|sex|level|userId/i.test(k))).toEqual([])
        const raw = JSON.stringify(res.body)
        for (const id of [ivanov.user.id, starov.user.id, petrov.user.id]) expect(raw).not.toContain(id)

        const people = res.body.matches.flatMap((m: { entryA: unknown; entryB: unknown }) => [m.entryA, m.entryB]).filter(Boolean)
        expect(people).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ personName: expect.stringContaining('Иванов'), clubName: 'ACADEMY', isMyClub: false, isMe: false }),
                expect.objectContaining({ personName: expect.stringContaining('Петров'), clubName: 'Беркут', isMyClub: true }),
                expect.objectContaining({ hidden: true, personName: null, clubName: null }),
            ]),
        )
        expect(raw).not.toContain('Старов')
        // The console hides the same person (§2.3: everywhere).
        const orgView = await http().get(`${base(s)}/divisions/${division.id}/bracket`).set(...s.secretary.auth).expect(200)
        expect(JSON.stringify(orgView.body)).not.toContain('Старов')
    })

    describe('every tournament route of the org console is closed to outsiders', () => {
        type Op = { method: 'get' | 'post' | 'patch' | 'put' | 'delete'; route: string }
        const ABSENT_ID = '00000000-0000-4000-8000-000000000000'
        const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../open-api.json'), 'utf8')) as {
            paths: Record<string, Record<string, unknown>>
        }
        const OPS: Op[] = Object.entries(spec.paths)
            .filter(([route]) => route.startsWith('/orgs/{organizationId}/') && /tournament/.test(route))
            .flatMap(([route, methods]) => Object.keys(methods).map((m) => ({ method: m as Op['method'], route })))
        const ADMIN_TIER = new Set([
            'post /orgs/{organizationId}/events/{eventId}/tournament',
            'patch /orgs/{organizationId}/tournaments/{tournamentId}',
            'post /orgs/{organizationId}/tournaments/{tournamentId}/publication',
        ])

        it('found the 21 tournament routes', () => {
            expect(OPS).toHaveLength(21)
            expect(OPS.filter((o) => ADMIN_TIER.has(`${o.method} ${o.route}`))).toHaveLength(3)
        })

        it('club staff and another federation get 404, no token 401, an org coach 403 on admin routes', async () => {
            const s = await setupTournament(ctx)
            const other = await createOrganization(ctx)
            const otherAdminUser = await createUser(ctx)
            await addOrgStaff(ctx, { organizationId: other.id, userId: otherAdminUser.id })
            const otherAdmin = await signIn(ctx, otherAdminUser.email!)
            const clubOwner = await signIn(ctx, s.academy.owner.email!)
            const url = (op: Op, orgId = s.org.id) =>
                op.route
                    .replace('{organizationId}', orgId)
                    .replace('{tournamentId}', s.tournament.id)
                    .replace('{eventId}', s.event.id)
                    .replace('{mat}', '1')
                    .replace(/\{[^}]+\}/g, ABSENT_ID)
            const leaked: string[] = []
            for (const op of OPS) {
                for (const [who, actor] of [['club coach', s.coach], ['club owner', clubOwner], ['other org admin', otherAdmin]] as const) {
                    const res = await http()[op.method](url(op)).set(...actor.auth).send({})
                    if (res.status !== 404) leaked.push(`${who} ${op.method} ${op.route} → ${res.status}`)
                }
                // Another org's admin naming their own org with this tournament's id.
                const mixed = await http()[op.method](url(op, other.id)).set(...otherAdmin.auth).send({})
                if (mixed.status < 400 || mixed.status >= 500) leaked.push(`mixed ${op.method} ${op.route} → ${mixed.status}`)
                const anon = await http()[op.method](url(op)).send({})
                if (anon.status !== 401) leaked.push(`anonymous ${op.method} ${op.route} → ${anon.status}`)
                if (ADMIN_TIER.has(`${op.method} ${op.route}`)) {
                    const coach = await http()[op.method](url(op)).set(...s.secretary.auth).send({ matCount: 2, published: true })
                    if (coach.status !== 403) leaked.push(`org coach ${op.method} ${op.route} → ${coach.status}`)
                }
            }
            expect(leaked).toEqual([])
            expect(await ctx.prisma.tournament.findUniqueOrThrow({ where: { id: s.tournament.id } })).toMatchObject({
                status: 'SETUP',
                matCount: 1,
            })
        })
    })
})
