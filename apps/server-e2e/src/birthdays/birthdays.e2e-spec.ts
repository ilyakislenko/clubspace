import { birthdateTurningOn } from '../../../server/src/domains/birthdays/birthdays'
import { DailyClubService } from '../../../server/src/domains/scheduler/daily-club.service'
import { localDateInTz } from '../../../server/src/features/attendance/attendance-utils'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createUser,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Birthdays (docs/design/2026-11-26-door-checkin-and-birthdays.md §3.2–3.4):
// the date is the person's, visible to staff and to themselves only; staff
// see «Дни рождения сегодня» scoped like their groups; the daily club pass
// greets once a year, a child through both guardians.
describe('birthdays: the date of birth, «Дни рождения сегодня» and the greeting', () => {
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

    // The default club time zone.
    const TZ = 'Europe/Moscow'
    const today = () => localDateInTz(new Date(), TZ)

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Самурай' })
        const { user: coach1 } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.COACH })
        const { user: coach2 } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.COACH })
        const { group: g1 } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach1.id,
            dayOfWeek: 1,
            name: 'Взрослые',
        })
        const { group: g2 } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach2.id,
            dayOfWeek: 3,
            name: 'Дети',
        })
        const { user: anna } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: boris } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.user.update({ where: { id: anna.id }, data: { firstname: 'Анна' } })
        await ctx.prisma.user.update({ where: { id: boris.id }, data: { firstname: 'Борис' } })
        await ctx.prisma.groupMember.createMany({
            data: [
                { groupId: g1.id, userId: anna.id },
                { groupId: g1.id, userId: boris.id },
            ],
        })
        // A coach with a birthday today is neither listed nor greeted.
        await ctx.prisma.user.update({
            where: { id: coach1.id },
            data: { dateOfBirth: new Date(`${birthdateTurningOn(today(), 40)}T00:00:00.000Z`) },
        })

        const parent1 = await signIn(ctx, 'parent1@example.com')
        const kid = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...parent1.auth)
                .send({
                    firstname: 'Аня',
                    lastname: 'Петрова',
                    dateOfBirth: birthdateTurningOn(today(), 8),
                    consent: true,
                })
                .expect(201)
        ).body as { id: string }
        await addMember(ctx, { workspaceId: workspace.id, userId: kid.id })
        await ctx.prisma.groupMember.create({ data: { groupId: g2.id, userId: kid.id } })
        const parent2 = await createUser(ctx, { email: 'parent2@example.com' })
        await ctx.prisma.guardianship.create({
            data: { guardianId: parent2.id, dependentId: kid.id, consentAt: new Date() },
        })

        return {
            workspace,
            owner,
            g1,
            anna,
            boris,
            kid,
            parent1,
            parent2,
            ownerActor: await signIn(ctx, owner.email as string),
            coach1Actor: await signIn(ctx, coach1.email as string),
            coach2Actor: await signIn(ctx, coach2.email as string),
            annaActor: await signIn(ctx, anna.email as string),
            borisActor: await signIn(ctx, boris.email as string),
        }
    }

    it('a member sets the date in their profile; staff see it, other students never do', async () => {
        const s = await setup()
        const dob = birthdateTurningOn(today(), 30)

        const saved = await ctx
            .http()
            .patch('/me')
            .set(...s.annaActor.auth)
            .send({ dateOfBirth: dob })
            .expect(200)
        expect(saved.body.dateOfBirth).toBe(dob)
        const me = await ctx.http().get('/me').set(...s.annaActor.auth).expect(200)
        expect(me.body.dateOfBirth).toBe(dob)
        await ctx
            .http()
            .patch('/me')
            .set(...s.annaActor.auth)
            .send({ dateOfBirth: '2999-01-01' })
            .expect(400)

        // Visits so both are on the board.
        const session = await ctx.prisma.attendanceSession.create({
            data: {
                workspaceId: s.workspace.id,
                groupId: s.g1.id,
                occurrenceKey: 'adhoc:birthday-board',
                title: 'Вечерняя',
                startAt: new Date(Date.now() - 3600_000),
                timezone: TZ,
                createdById: s.owner.id,
            },
        })
        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/attendance/sessions/${session.id}/records`)
            .set(...s.ownerActor.auth)
            .send({ userIds: [s.anna.id, s.boris.id] })
            .expect(201)

        // Every member-facing read another student has.
        const board = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/leaderboard`)
            .set(...s.borisActor.auth)
            .expect(200)
        expect(JSON.stringify(board.body)).toContain(s.anna.id)
        const groups = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/groups`)
            .set(...s.borisActor.auth)
            .expect(200)
        for (const body of [board.body, groups.body]) {
            expect(JSON.stringify(body)).not.toContain(dob)
            expect(JSON.stringify(body)).not.toContain('dateOfBirth')
        }
        // The staff reads refuse a student.
        await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${s.anna.id}/progress`)
            .set(...s.borisActor.auth)
            .expect(403)
        await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/birthdays/today`)
            .set(...s.borisActor.auth)
            .expect(403)

        // Staff see it on the member card and can correct it.
        const progress = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${s.anna.id}/progress`)
            .set(...s.coach1Actor.auth)
            .expect(200)
        expect(progress.body.member.dateOfBirth).toBe(dob)
        const edited = await ctx
            .http()
            .patch(`/workspaces/${s.workspace.id}/members/${s.anna.id}/profile`)
            .set(...s.ownerActor.auth)
            .send({ dateOfBirth: null })
            .expect(200)
        expect(edited.body.dateOfBirth).toBeNull()
    })

    it('lists today\'s birthdays: the club for the owner, own groups for a coach', async () => {
        const s = await setup()
        await ctx
            .http()
            .patch('/me')
            .set(...s.annaActor.auth)
            .send({ dateOfBirth: birthdateTurningOn(today(), 30) })
            .expect(200)

        const all = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/birthdays/today`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(all.body.date).toBe(today())
        expect(all.body.members).toEqual([
            {
                userId: s.anna.id,
                name: 'Анна',
                photoUrl: null,
                isDependent: false,
                turns: null,
                groups: [{ id: s.g1.id, name: 'Взрослые' }],
            },
            expect.objectContaining({
                userId: s.kid.id,
                name: 'Аня Петрова',
                isDependent: true,
                turns: Number(today().slice(0, 4)) - Number(birthdateTurningOn(today(), 8).slice(0, 4)),
            }),
        ])

        const mine = async (auth: [string, string]) =>
            (
                await ctx
                    .http()
                    .get(`/workspaces/${s.workspace.id}/birthdays/today`)
                    .set(...auth)
                    .expect(200)
            ).body.members.map((m: { userId: string }) => m.userId)
        expect(await mine(s.coach1Actor.auth)).toEqual([s.anna.id])
        expect(await mine(s.coach2Actor.auth)).toEqual([s.kid.id])
    })

    it('greets at 10:00 club-local once: the adult directly, the child via both guardians', async () => {
        const s = await setup()
        await ctx
            .http()
            .patch('/me')
            .set(...s.annaActor.auth)
            .send({ dateOfBirth: birthdateTurningOn(today(), 30) })
            .expect(200)
        const daily = ctx.app.get(DailyClubService)
        // 10:05 in Moscow (UTC+3) of the club's today.
        const at10 = new Date(`${today()}T07:05:00.000Z`)

        expect((await daily.run(at10)).birthdaysGreeted).toBe(3)
        const greetings = await ctx.prisma.notification.findMany({
            where: { metadata: { path: ['kind'], equals: 'member.birthday' } },
            select: { userId: true, topic: true, message: true, metadata: true },
            orderBy: { userId: 'asc' },
        })
        const byUser = new Map(greetings.map((g) => [g.userId, g]))
        expect([...byUser.keys()].sort()).toEqual([s.anna.id, s.parent1.userId, s.parent2.id].sort())
        expect(byUser.get(s.anna.id)).toMatchObject({
            topic: 'С днём рождения!',
            message: 'Клуб «Самурай» поздравляет с днём рождения! Здоровья, сил и радости от тренировок.',
        })
        for (const parentId of [s.parent1.userId, s.parent2.id]) {
            expect(byUser.get(parentId)).toMatchObject({
                topic: 'Аня: С днём рождения!',
                metadata: { kind: 'member.birthday', workspaceId: s.workspace.id, dependentId: s.kid.id },
            })
        }

        // The 11:00 retry pass of the same day: nobody twice, even with the
        // club-day claim released.
        await ctx.prisma.notificationDispatchLog.deleteMany({ where: { kind: 'club.daily.run' } })
        const at11 = new Date(at10.getTime() + 3600_000)
        expect((await daily.run(at11)).birthdaysGreeted).toBe(0)
        expect(
            await ctx.prisma.notification.count({
                where: { metadata: { path: ['kind'], equals: 'member.birthday' } },
            }),
        ).toBe(3)
    })

    it('greets nobody once the club switches greetings off', async () => {
        const s = await setup()
        const off = await ctx
            .http()
            .patch(`/workspaces/${s.workspace.id}/settings`)
            .set(...s.ownerActor.auth)
            .send({ birthdayGreetingsEnabled: false })
            .expect(200)
        expect(off.body.birthdayGreetingsEnabled).toBe(false)
        const read = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/settings`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(read.body.birthdayGreetingsEnabled).toBe(false)

        const at10 = new Date(`${today()}T07:05:00.000Z`)
        expect((await ctx.app.get(DailyClubService).run(at10)).birthdaysGreeted).toBe(0)
        expect(
            await ctx.prisma.notification.count({
                where: { metadata: { path: ['kind'], equals: 'member.birthday' } },
            }),
        ).toBe(0)
    })
})
