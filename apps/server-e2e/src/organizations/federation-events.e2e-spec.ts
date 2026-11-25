import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

// Federation events (docs/design/2026-11-26-federation-hub-mvp.md §2, §3.3):
// free registration through one's own member club, consent first, a coach may
// book only consenting students of their own groups, no waitlist.
describe('federation events', () => {
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
        const org = await createOrganization(ctx, { name: 'Федерация БЖЖ', timezone: 'Asia/Tomsk' })
        const adminUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: adminUser.id })
        const orgAdmin = await signIn(ctx, adminUser.email!)

        const club = async (name: string, sharing = {}) => {
            const { workspace } = await createWorkspace(ctx, { name })
            const link = await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id, sharing })
            const member = async (role?: RolesEnum, firstname?: string) => {
                const user = await createUser(ctx, { firstname })
                await addMember(ctx, { workspaceId: workspace.id, userId: user.id, role })
                return { user, actor: await signIn(ctx, user.email!) }
            }
            return { workspace, link, member }
        }
        const academy = await club('ACADEMY')
        const berkut = await club('Беркут')
        const coach = await academy.member(RolesEnum.COACH, 'Тренер')
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: academy.workspace.id,
            coachUserId: coach.user.id,
            dayOfWeek: 2,
        })
        const inGroup = async (firstname: string) => {
            const m = await academy.member(undefined, firstname)
            await ctx.prisma.groupMember.create({ data: { groupId: group.id, userId: m.user.id } })
            return m
        }
        return { org, orgAdmin, academy, berkut, coach, inGroup }
    }
    type Setup = Awaited<ReturnType<typeof setup>>

    const createEvent = async (s: Setup, body: Record<string, unknown> = {}) =>
        (
            await http()
                .post(`/orgs/${s.org.id}/events`)
                .set(...s.orgAdmin.auth)
                .send({
                    kind: 'COMPETITION',
                    title: 'Открытый турнир Томской области',
                    startAt: '2030-12-20T10:00',
                    endAt: '2030-12-20T18:00',
                    hostClubId: s.academy.workspace.id,
                    capacity: 2,
                    feeNote: 'Взнос 1 500 ₽ на месте',
                    ...body,
                })
                .expect(201)
        ).body as { id: string; startAt: string; timezone: string; hostClub: { name: string } }
    const consent = (workspaceId: string, orgId: string, actor: Actor) =>
        http()
            .put(`/workspaces/${workspaceId}/me/organizations/${orgId}/consent`)
            .set(...actor.auth)
            .send({ granted: true })
            .expect(200)
    const registerVia = (workspaceId: string, eventId: string, actor: Actor, userId?: string) =>
        http()
            .post(`/workspaces/${workspaceId}/org-events/${eventId}/registrations`)
            .set(...actor.auth)
            .send(userId ? { userId } : {})

    it('member registers through their own club, coach registers a consenting student, capacity is enforced', async () => {
        const s = await setup()
        const event = await createEvent(s)
        // 10:00 typed in the org zone (Tomsk, UTC+7).
        expect(event).toMatchObject({
            startAt: '2030-12-20T03:00:00.000Z',
            timezone: 'Asia/Tomsk',
            hostClub: { name: 'ACADEMY' },
        })
        const w = s.academy.workspace.id

        // The member sees it in the app's «События», with the fee as text.
        const anna = await s.inGroup('Анна')
        const listed = (await http().get(`/workspaces/${w}/org-events`).set(...anna.actor.auth).expect(200))
            .body.data
        expect(listed).toEqual([
            expect.objectContaining({
                id: event.id,
                organizationName: 'Федерация БЖЖ',
                hostClubName: 'ACADEMY',
                feeNote: 'Взнос 1 500 ₽ на месте',
                registrationState: 'OPEN',
                bookedCount: 0,
                myRegistration: null,
            }),
        ])

        // Consent first, then the place; re-sending is idempotent.
        const refused = await registerVia(w, event.id, anna.actor).expect(409)
        expect(refused.body.code).toBe('ORG_CONSENT_REQUIRED')
        await consent(w, s.org.id, anna.actor)
        const booked = (await registerVia(w, event.id, anna.actor).expect(201)).body
        expect(booked).toMatchObject({ status: 'BOOKED', bookedCount: 1 })
        expect((await registerVia(w, event.id, anna.actor).expect(201)).body.id).toBe(booked.id)

        // A coach books a student of their group — only once the student consented.
        const boris = await s.inGroup('Борис')
        const picker = (
            await http()
                .get(`/workspaces/${w}/org-events/${event.id}/students`)
                .set(...s.coach.actor.auth)
                .expect(200)
        ).body.data
        expect(picker).toEqual([
            expect.objectContaining({ name: 'Анна', consented: true, registration: expect.objectContaining({ status: 'BOOKED' }) }),
            expect.objectContaining({ name: 'Борис', consented: false, registration: null }),
        ])
        const noConsent = await registerVia(w, event.id, s.coach.actor, boris.user.id).expect(409)
        expect(noConsent.body.code).toBe('ORG_CONSENT_REQUIRED')
        await consent(w, s.org.id, boris.actor)
        await registerVia(w, event.id, s.coach.actor, boris.user.id).expect(201)
        const told = await ctx.prisma.notification.findMany({
            where: { userId: boris.user.id, metadata: { path: ['kind'], equals: 'org_event.registered_by_club' } },
        })
        expect(told).toHaveLength(1)

        // A student outside the coach's groups; a member booking someone else.
        const outsider = await s.academy.member(undefined, 'Вера')
        await consent(w, s.org.id, outsider.actor)
        await registerVia(w, event.id, s.coach.actor, outsider.user.id).expect(403)
        await registerVia(w, event.id, anna.actor, outsider.user.id).expect(403)

        // Two places, both taken: no waitlist.
        const full = await registerVia(w, event.id, outsider.actor).expect(409)
        expect(full.body).toMatchObject({ code: 'ORG_EVENT_FULL', message: 'Мест нет' })
        const state = (await http().get(`/workspaces/${w}/org-events`).set(...outsider.actor.auth).expect(200))
            .body.data[0]
        expect(state).toMatchObject({ registrationState: 'FULL', bookedCount: 2, myRegistration: null })

        // The org sees both under ACADEMY: who booked, nothing else about them.
        const regs = (
            await http()
                .get(`/orgs/${s.org.id}/events/${event.id}/registrations`)
                .set(...s.orgAdmin.auth)
                .expect(200)
        ).body
        expect(regs.hiddenCount).toBe(0)
        expect(
            regs.data.map((r: { personName: string; clubName: string; bookedBy: string; status: string }) => [
                r.personName,
                r.clubName,
                r.bookedBy,
                r.status,
            ]),
        ).toEqual([
            ['Анна', 'ACADEMY', 'SELF', 'BOOKED'],
            ['Борис', 'ACADEMY', 'COACH', 'BOOKED'],
        ])
        expect(JSON.stringify(regs)).not.toContain(anna.user.id)
        expect(JSON.stringify(regs)).not.toContain(anna.user.email)

        // A place given back goes to the next person at once.
        await http()
            .delete(`/workspaces/${w}/org-event-registrations/${booked.id}`)
            .set(...anna.actor.auth)
            .expect(200)
        await registerVia(w, event.id, outsider.actor).expect(201)

        // Withdrawing consent hides the person from the org but keeps the place counted.
        await http()
            .put(`/workspaces/${w}/me/organizations/${s.org.id}/consent`)
            .set(...boris.actor.auth)
            .send({ granted: false })
            .expect(200)
        const after = (
            await http()
                .get(`/orgs/${s.org.id}/events/${event.id}/registrations`)
                .set(...s.orgAdmin.auth)
                .expect(200)
        ).body
        expect(after.hiddenCount).toBe(1)
        expect(after.data.map((r: { personName: string }) => r.personName)).toEqual(['Анна', 'Вера'])
    })

    it('a club that turned federation events off, or is not a member, sees and books nothing', async () => {
        const s = await setup()
        const event = await createEvent(s, { capacity: null })
        const off = await s.berkut.member(undefined, 'Глеб')
        await ctx.prisma.organizationClub.update({
            where: { id: s.berkut.link.id },
            data: { allowMemberEvents: false },
        })
        const wb = s.berkut.workspace.id
        await consent(wb, s.org.id, off.actor)
        expect(
            (await http().get(`/workspaces/${wb}/org-events`).set(...off.actor.auth).expect(200)).body.data,
        ).toEqual([])
        await registerVia(wb, event.id, off.actor).expect(404)

        // Not linked at all.
        const { workspace: stranger } = await createWorkspace(ctx, { name: 'Ритм' })
        const dancerUser = await createUser(ctx)
        await addMember(ctx, { workspaceId: stranger.id, userId: dancerUser.id })
        const dancer = await signIn(ctx, dancerUser.email!)
        await registerVia(stranger.id, event.id, dancer).expect(404)

        // A coaches-only seminar is invisible to members and open to the club's staff.
        const seminar = await createEvent(s, { kind: 'SEMINAR', title: 'Семинар для тренеров', audience: 'STAFF', capacity: null })
        const anna = await s.inGroup('Анна')
        const w = s.academy.workspace.id
        const forMember = (await http().get(`/workspaces/${w}/org-events`).set(...anna.actor.auth).expect(200))
            .body.data
        expect(forMember.map((e: { id: string }) => e.id)).toEqual([event.id])
        await registerVia(w, seminar.id, anna.actor).expect(404)
        await consent(w, s.org.id, s.coach.actor)
        await registerVia(w, seminar.id, s.coach.actor).expect(201)
    })
})
