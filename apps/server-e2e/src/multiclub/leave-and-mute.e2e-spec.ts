import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createGroupWithSlot, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// A member leaves a club on their own (same hand-over rule as deleting the
// account) and can mute one club's notifications.
describe('leave a club, mute a club', () => {
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

    const leave = (actor: { auth: [string, string] }, workspaceId: string) =>
        ctx.http().delete(`/me/memberships/${workspaceId}`).set(...actor.auth)

    it('a member leaves: membership, roster place and bookings go, audited', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek: 1,
        })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.groupMember.create({ data: { groupId: group.id, userId: user.id } })
        const actor = await signIn(ctx, user.email)

        await leave(actor, workspace.id).expect(200).expect({ status: 'left' })

        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: user.id, workspaceId: workspace.id },
            }),
        ).toBe(0)
        expect(await ctx.prisma.groupMember.count({ where: { userId: user.id } })).toBe(0)
        expect(
            await ctx.prisma.auditEvent.count({
                where: { action: 'member.leave', workspaceId: workspace.id, actorId: user.id },
            }),
        ).toBe(1)
        // Gone from the club: its routes refuse now.
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule`)
            .query({ from: '2030-01-07', to: '2030-01-13' })
            .set(...actor.auth)
            .expect(403)
    })

    it('refuses the owner', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const actor = await signIn(ctx, owner.email)
        const res = await leave(actor, workspace.id).expect(400)
        expect(JSON.stringify(res.body)).toContain('владелец')
    })

    it('refuses the primary coach of a group until it is handed over', async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek: 1,
        })
        const actor = await signIn(ctx, coach.email)
        const res = await leave(actor, workspace.id).expect(400)
        expect(JSON.stringify(res.body)).toContain('главный тренер')
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: coach.id, workspaceId: workspace.id },
            }),
        ).toBe(1)

        // Handed over: now they may go.
        const { owner } = await ctx.prisma.workspace
            .findUniqueOrThrow({ where: { id: workspace.id }, select: { ownerId: true } })
            .then((w) => ({ owner: w.ownerId }))
        await ctx.prisma.group.update({ where: { id: group.id }, data: { coachId: owner } })
        await leave(actor, workspace.id).expect(200)
    })

    it('404s for a club the caller is not in, 400 for a malformed id', async () => {
        const { workspace } = await createWorkspace(ctx)
        const actor = await signIn(ctx, 'stranger@example.com')
        await leave(actor, workspace.id).expect(404)
        await leave(actor, 'not-a-uuid').expect(400)
    })

    it('mutes and unmutes a club, reflected in my clubs', async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        const actor = await signIn(ctx, user.email)
        const mine = async () =>
            (
                await ctx.http().post('/get-my-workspaces').set(...actor.auth).send({}).expect(201)
            ).body.data[0]

        expect(await mine()).toMatchObject({ notificationsMuted: false, unreadNotifications: 0 })
        await ctx
            .http()
            .patch(`/me/memberships/${workspace.id}/notifications`)
            .set(...actor.auth)
            .send({ muted: true })
            .expect(200)
            .expect({ workspaceId: workspace.id, notificationsMuted: true })
        expect((await mine()).notificationsMuted).toBe(true)
        await ctx
            .http()
            .patch(`/me/memberships/${workspace.id}/notifications`)
            .set(...actor.auth)
            .send({ muted: false })
            .expect(200)
        expect((await mine()).notificationsMuted).toBe(false)
    })

    it('counts unread notifications per club', async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.notification.createMany({
            data: [
                { userId: user.id, type: 'PUSH', topic: 't', message: 'm', metadata: { workspaceId: workspace.id } },
                { userId: user.id, type: 'PUSH', topic: 't', message: 'm', metadata: { workspaceId: workspace.id } },
                { userId: user.id, type: 'PUSH', topic: 't', message: 'm', seen: true, metadata: { workspaceId: workspace.id } },
                { userId: user.id, type: 'PUSH', topic: 't', message: 'm', metadata: { workspaceId: 'other' } },
            ],
        })
        const actor = await signIn(ctx, user.email)
        const res = await ctx.http().post('/get-my-workspaces').set(...actor.auth).send({}).expect(201)
        expect(res.body.data[0].unreadNotifications).toBe(2)
    })
})
