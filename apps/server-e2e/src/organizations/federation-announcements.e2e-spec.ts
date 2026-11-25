import { RemindersService } from '../../../server/src/domains/scheduler/reminders.service'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

// Federation announcements (docs/design/2026-11-26-federation-hub-mvp.md §3.3,
// §3.4): a push to member clubs' staff outside each club's quiet hours, the
// members only through the feed, and only where the club allows it.
describe('federation announcements', () => {
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

    it('reaches staff by push outside quiet hours and members only through the feed of clubs that allow it', async () => {
        const org = await createOrganization(ctx, { name: 'Федерация БЖЖ' })
        const adminUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: adminUser.id })
        const orgAdmin = await signIn(ctx, adminUser.email!)
        const coachUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: coachUser.id, role: 'ORG_COACH' })
        const orgCoach = await signIn(ctx, coachUser.email!)

        const club = async (name: string, timezone: string, sharing = {}) => {
            const { workspace, owner } = await createWorkspace(ctx, { name, ownerMembership: false })
            await ctx.prisma.workspace.update({ where: { id: workspace.id }, data: { timezone } })
            const link = await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id, sharing })
            const coach = await createUser(ctx)
            await addMember(ctx, { workspaceId: workspace.id, userId: coach.id, role: RolesEnum.COACH })
            const student = await createUser(ctx)
            await addMember(ctx, { workspaceId: workspace.id, userId: student.id })
            return {
                workspace,
                owner,
                link,
                coach,
                student,
                ownerActor: await signIn(ctx, owner.email!),
                studentActor: await signIn(ctx, student.email!),
            }
        }
        const academy = await club('ACADEMY', 'Asia/Tomsk')
        const quiet = await club('Беркут', 'Asia/Vladivostok', { allowMemberAnnouncements: false })

        const post = (body: Record<string, unknown>, actor: Actor = orgAdmin) =>
            http().post(`/orgs/${org.id}/announcements`).set(...actor.auth).send(body)

        // Org coaches read announcements but don't write them.
        await post({ title: 'x', body: 'y', publish: true }, orgCoach).expect(403)
        const members = (
            await post({
                title: 'Положение о турнире опубликовано',
                body: 'Регламент во вложении',
                audience: 'STAFF_AND_MEMBERS',
                publish: true,
            }).expect(201)
        ).body
        const staffOnly = (
            await post({ title: 'Собрание тренеров 5 декабря', body: 'В 19:00', publish: true }).expect(201)
        ).body
        expect(staffOnly.audience).toBe('STAFF')
        expect(
            (await http().get(`/orgs/${org.id}/announcements`).set(...orgCoach.auth).expect(200)).body.total,
        ).toBe(2)

        const feed = async (workspaceId: string, actor: Actor) =>
            (
                await http()
                    .get(`/workspaces/${workspaceId}/announcements/feed`)
                    .set(...actor.auth)
                    .expect(200)
            ).body.data as Array<{ id: string; source?: { kind: string; name: string } }>

        // A member of ACADEMY sees the members' one, tagged; the staff one is not theirs.
        const studentFeed = await feed(academy.workspace.id, academy.studentActor)
        expect(studentFeed.map((a) => a.id)).toEqual([members.id])
        expect(studentFeed[0].source).toEqual({
            kind: 'organization',
            organizationId: org.id,
            name: 'Федерация БЖЖ',
        })
        // The owner reads both.
        expect((await feed(academy.workspace.id, academy.ownerActor)).map((a) => a.id).sort()).toEqual(
            [members.id, staffOnly.id].sort(),
        )
        // Беркут switched federation news off for members; its staff still read them.
        expect(await feed(quiet.workspace.id, quiet.studentActor)).toEqual([])
        expect((await feed(quiet.workspace.id, quiet.ownerActor)).length).toBe(2)

        // The minute job at 14:00 UTC: 21:00 in Tomsk (awake), 00:00 in
        // Vladivostok (quiet).
        const reminders = ctx.app.get(RemindersService)
        const evening = new Date()
        evening.setUTCHours(14, 0, 0, 0)
        await ctx.prisma.organizationAnnouncement.updateMany({ data: { publishedAt: new Date(evening.getTime() - 60_000) } })
        const first = await reminders.run(evening)
        expect(first.orgAnnouncementsNotified).toBe(2)
        const pushes = async (userId: string) =>
            ctx.prisma.notification.findMany({
                where: { userId, metadata: { path: ['kind'], equals: 'org.announcement' } },
            })
        expect(await pushes(academy.owner.id)).toHaveLength(2)
        expect(await pushes(academy.coach.id)).toHaveLength(2)
        expect(await pushes(academy.student.id)).toHaveLength(0)
        expect(await pushes(quiet.owner.id)).toHaveLength(0)
        expect(
            (await ctx.prisma.organizationAnnouncement.findMany({ where: { staffNotifiedAt: null } })).length,
        ).toBe(2)

        // The next morning in Vladivostok (00:00 UTC + 10h = 10:00 there): its staff get it, once.
        const morning = new Date(evening.getTime() + 10 * 3_600_000)
        await reminders.run(morning)
        await reminders.run(new Date(morning.getTime() + 60_000))
        expect(await pushes(quiet.owner.id)).toHaveLength(2)
        expect(await pushes(quiet.coach.id)).toHaveLength(2)
        expect(await pushes(academy.owner.id)).toHaveLength(2)
        expect(
            (await ctx.prisma.organizationAnnouncement.findMany({ where: { staffNotifiedAt: null } })).length,
        ).toBe(0)

        // Audited on the org side.
        const audit = await ctx.prisma.auditEvent.findMany({
            where: { organizationId: org.id, action: 'org.announcementCreate' },
        })
        expect(audit).toHaveLength(2)
        expect(audit.every((a) => a.workspaceId === null)).toBe(true)
    })
})
