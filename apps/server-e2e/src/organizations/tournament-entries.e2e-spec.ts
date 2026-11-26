import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createUser } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import {
    actorFor,
    clubPerson,
    createDivisions,
    setupTournament,
    type TournamentSetup,
} from './org-fixtures'

// Tournament entries (docs/design/2026-11-27-tournaments.md §2.1, §2.2, §2.4,
// §5.2): the athlete declares a weight through their club, their coach
// confirms and the entry finds its division; the tournament edition of the
// federation consent is required; weigh-in locks the club out.
describe('tournament entries', () => {
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

    const setup = async () => {
        const s = await setupTournament(ctx)
        const [light, heavy] = await createDivisions(ctx, s, [
            { sex: 'MALE', weightMaxKg: 76 },
            { sex: 'MALE', weightMinKg: 76 },
        ])
        // An athlete of the coach's group, signed in, booked through ACADEMY.
        const athlete = async (firstname: string, lastname: string, consent?: false | string) => {
            const user = await clubPerson(ctx, {
                organizationId: s.org.id,
                club: s.academy.workspace,
                firstname,
                lastname,
                groupId: s.group.id,
                consent,
            })
            const actor = await actorFor(ctx, user)
            await register(s, actor).expect(201)
            return { user, actor }
        }
        return { ...s, light, heavy, athlete }
    }

    const w = (s: TournamentSetup) => s.academy.workspace.id
    const register = (s: TournamentSetup, actor: Actor, userId?: string) =>
        http()
            .post(`/workspaces/${w(s)}/org-events/${s.event.id}/registrations`)
            .set(...actor.auth)
            .send(userId ? { userId } : {})
    const declare = (s: TournamentSetup, actor: Actor, body: Record<string, unknown>) =>
        http()
            .put(`/workspaces/${w(s)}/org-events/${s.event.id}/tournament/entry`)
            .set(...actor.auth)
            .send({ sex: 'MALE', ...body })
    const confirm = (s: TournamentSetup, actor: Actor, entryId: string, body: Record<string, unknown> = {}) =>
        http()
            .post(`/workspaces/${w(s)}/tournament-entries/${entryId}/confirm`)
            .set(...actor.auth)
            .send(body)
    const clubTournament = (s: TournamentSetup, actor: Actor, workspaceId = w(s)) =>
        http().get(`/workspaces/${workspaceId}/org-events/${s.event.id}/tournament`).set(...actor.auth)
    const setStatus = (s: TournamentSetup, status: string) =>
        http()
            .post(`/orgs/${s.org.id}/tournaments/${s.tournament.id}/status`)
            .set(...s.secretary.auth)
            .send({ status })

    it('athlete declares weight, own coach confirms and the entry lands in the matching division', async () => {
        const s = await setup()
        const ivan = await s.athlete('Иван', 'Иванов')

        // Self-declaration: DECLARED, birth year from the profile, no division yet.
        const declared = (await declare(s, ivan.actor, { declaredWeightKg: 75.4 }).expect(200)).body
        expect(declared).toMatchObject({
            userId: ivan.user.id,
            status: 'DECLARED',
            birthYear: 2000,
            declaredWeightKg: 75.4,
            divisionId: null,
        })

        // The coach sees it waiting, with the weight (own club staff).
        expect((await clubTournament(s, s.coach).expect(200)).body.toConfirmCount).toBe(1)
        const athletes = (
            await http()
                .get(`/workspaces/${w(s)}/org-events/${s.event.id}/tournament/athletes`)
                .set(...s.coach.auth)
                .expect(200)
        ).body
        expect(athletes.toConfirmCount).toBe(1)
        expect(athletes.data).toEqual([
            expect.objectContaining({
                userId: ivan.user.id,
                consentCurrent: true,
                entry: expect.objectContaining({ id: declared.id, status: 'DECLARED', declaredWeightKg: 75.4 }),
            }),
        ])

        // Confirmation: the one fitting division.
        const confirmed = (await confirm(s, s.coach, declared.id).expect(201)).body
        expect(confirmed).toMatchObject({
            status: 'CONFIRMED',
            divisionId: s.light.id,
            divisionName: s.light.name,
        })
        expect((await clubTournament(s, s.coach).expect(200)).body.toConfirmCount).toBe(0)

        // The athlete's own screen shows the division and their own weight.
        const mine = (await clubTournament(s, ivan.actor).expect(200)).body
        expect(mine).toMatchObject({
            status: 'SETUP',
            consentCurrent: true,
            canDeclare: true,
            toConfirmCount: null,
            myEntry: { status: 'CONFIRMED', divisionName: s.light.name, declaredWeightKg: 75.4 },
        })

        // The federation's list has the entry in the division with the weight.
        const entries = (
            await http()
                .get(`/orgs/${s.org.id}/tournaments/${s.tournament.id}/entries`)
                .set(...s.secretary.auth)
                .expect(200)
        ).body
        expect(entries.data).toEqual([
            expect.objectContaining({
                id: declared.id,
                hidden: false,
                personName: expect.stringContaining('Иван'),
                clubName: 'ACADEMY',
                declaredWeightKg: 75.4,
                divisionId: s.light.id,
                status: 'CONFIRMED',
            }),
        ])

        // Re-sending the same facts keeps the confirmation; a new weight resets it.
        await declare(s, ivan.actor, { declaredWeightKg: 75.4 }).expect(200)
        expect((await clubTournament(s, ivan.actor).expect(200)).body.myEntry.status).toBe('CONFIRMED')
        const changed = (await declare(s, ivan.actor, { declaredWeightKg: 81 }).expect(200)).body
        expect(changed).toMatchObject({ id: declared.id, status: 'DECLARED', divisionId: null })

        // A coach's own declaration for a student is confirmed at once.
        const petr = await clubPerson(ctx, {
            organizationId: s.org.id,
            club: s.academy.workspace,
            firstname: 'Пётр',
            lastname: 'Петров',
            groupId: s.group.id,
        })
        await register(s, s.coach, petr.id).expect(201)
        const byCoach = (await declare(s, s.coach, { userId: petr.id, declaredWeightKg: 80 }).expect(200)).body
        expect(byCoach).toMatchObject({ userId: petr.id, status: 'CONFIRMED', divisionId: s.heavy.id })
    })

    it('a coach of another group cannot confirm and org staff cannot call the club routes', async () => {
        const s = await setup()
        const ivan = await s.athlete('Иван', 'Иванов')
        const entry = (await declare(s, ivan.actor, { declaredWeightKg: 75 }).expect(200)).body

        // A coach of the same club, another group.
        const otherCoachUser = await createUser(ctx, { firstname: 'Другой' })
        await addMember(ctx, { workspaceId: w(s), userId: otherCoachUser.id, role: RolesEnum.COACH })
        await createGroupWithSlot(ctx, { workspaceId: w(s), coachUserId: otherCoachUser.id, dayOfWeek: 4 })
        const otherCoach = await signIn(ctx, otherCoachUser.email!)
        await confirm(s, otherCoach, entry.id).expect(403)
        await declare(s, otherCoach, { userId: ivan.user.id, declaredWeightKg: 75 }).expect(403)
        // An athlete can't confirm (themselves or anyone).
        await confirm(s, ivan.actor, entry.id).expect(403)
        // A coach of another club can't see the entry at all.
        const berkutCoachUser = await createUser(ctx)
        await addMember(ctx, { workspaceId: s.berkut.workspace.id, userId: berkutCoachUser.id, role: RolesEnum.COACH })
        const berkutCoach = await signIn(ctx, berkutCoachUser.email!)
        await http()
            .post(`/workspaces/${s.berkut.workspace.id}/tournament-entries/${entry.id}/confirm`)
            .set(...berkutCoach.auth)
            .send({})
            .expect(404)
        expect((await ctx.prisma.tournamentEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('DECLARED')

        // Org staff never get club routes, club staff never get org routes.
        for (const staff of [s.orgAdmin, s.secretary]) {
            for (const res of [
                await clubTournament(s, staff),
                await confirm(s, staff, entry.id),
                await declare(s, staff, { userId: ivan.user.id, declaredWeightKg: 75 }),
            ]) {
                expect(res.status).toBeGreaterThanOrEqual(400)
                expect(res.status).toBeLessThan(500)
            }
        }
        for (const clubStaff of [s.coach, await signIn(ctx, s.academy.owner.email!)]) {
            await http().get(`/orgs/${s.org.id}/tournaments/${s.tournament.id}`).set(...clubStaff.auth).expect(404)
            await http()
                .get(`/orgs/${s.org.id}/tournaments/${s.tournament.id}/entries`)
                .set(...clubStaff.auth)
                .expect(404)
        }
    })

    it('an older consent edition gets ORG_CONSENT_REQUIRED and passes after re-granting', async () => {
        const s = await setup()
        // Consent from the hub's first edition: enough to book, not to enter.
        const ivan = await s.athlete('Иван', 'Иванов', '2026-11-26.1')
        expect((await clubTournament(s, ivan.actor).expect(200)).body).toMatchObject({
            consentCurrent: false,
            consentVersion: '2026-11-27.1',
            myEntry: null,
        })
        const refused = await declare(s, ivan.actor, { declaredWeightKg: 75 }).expect(409)
        expect(refused.body.code).toBe('ORG_CONSENT_REQUIRED')
        // The coach can't consent for the student and is told so.
        const byCoach = await declare(s, s.coach, { userId: ivan.user.id, declaredWeightKg: 75 }).expect(409)
        expect(byCoach.body).toMatchObject({
            code: 'ORG_CONSENT_REQUIRED',
            message: 'Ученик должен обновить согласие в приложении',
        })
        expect(await ctx.prisma.tournamentEntry.count()).toBe(0)

        // «Разрешить» re-grants the current edition over the older one.
        await http()
            .put(`/workspaces/${w(s)}/me/organizations/${s.org.id}/consent`)
            .set(...ivan.actor.auth)
            .send({ granted: true })
            .expect(200)
        expect((await clubTournament(s, ivan.actor).expect(200)).body.consentCurrent).toBe(true)
        await declare(s, ivan.actor, { declaredWeightKg: 75 }).expect(200)
        const records = await ctx.prisma.consentRecord.findMany({
            where: { userId: ivan.user.id, kind: 'ORGANIZATION_SHARING', withdrawnAt: null },
            select: { version: true },
            orderBy: { acceptedAt: 'asc' },
        })
        expect(records.map((r) => r.version)).toContain('2026-11-27.1')
    })

    it('after weigh-in starts the club can neither change nor cancel an entry', async () => {
        const s = await setup()
        const ivan = await s.athlete('Иван', 'Иванов')
        const entry = (await declare(s, ivan.actor, { declaredWeightKg: 75 }).expect(200)).body
        const { id: registrationId } = await ctx.prisma.organizationEventRegistration.findFirstOrThrow({
            where: { userId: ivan.user.id },
        })
        const cancel = () =>
            http()
                .delete(`/workspaces/${w(s)}/org-event-registrations/${registrationId}`)
                .set(...ivan.actor.auth)

        await setStatus(s, 'WEIGH_IN').expect(201)
        expect((await clubTournament(s, ivan.actor).expect(200)).body).toMatchObject({
            status: 'WEIGH_IN',
            canDeclare: false,
        })
        for (const res of [
            await declare(s, ivan.actor, { declaredWeightKg: 74 }),
            await declare(s, s.coach, { userId: ivan.user.id, declaredWeightKg: 74 }),
            await confirm(s, s.coach, entry.id),
            await cancel(),
        ]) {
            expect(res.status).toBe(409)
            expect(res.body).toMatchObject({
                code: 'TOURNAMENT_LOCKED',
                message: 'Заявки закрыты — изменения через секретаря турнира',
            })
        }
        expect(await ctx.prisma.tournamentEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
            status: 'DECLARED',
            declaredWeightG: 75_000,
        })
        expect(
            (await ctx.prisma.organizationEventRegistration.findUniqueOrThrow({ where: { id: registrationId } })).status,
        ).toBe('BOOKED')

        // Back to SETUP («Вернуть приём заявок»): cancelling takes the entry with it.
        await setStatus(s, 'SETUP').expect(201)
        await cancel().expect(200)
        expect(await ctx.prisma.tournamentEntry.count({ where: { id: entry.id } })).toBe(0)
    })
})
