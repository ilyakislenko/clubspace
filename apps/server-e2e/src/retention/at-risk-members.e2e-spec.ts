import { randomUUID } from 'crypto'

import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// «Кто пропадает» against real Postgres: the engine's groupBy / window reads,
// the coach scope through GroupCoach, and the snooze written by «Связались».
describe('at-risk members', () => {
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

    // One visit: an ad-hoc session plus a record with an explicit markedAt.
    const visit = async (
        workspaceId: string,
        groupId: string,
        userId: string,
        markedById: string,
        daysAgo: number,
    ) => {
        const at = new Date(Date.now() - daysAgo * DAY)
        const session = await ctx.prisma.attendanceSession.create({
            data: {
                workspaceId,
                groupId,
                occurrenceKey: `adhoc:${groupId}:${at.toISOString()}:${userId}`,
                title: 'Тренировка',
                startAt: at,
                timezone: 'Asia/Tomsk',
                createdById: markedById,
            },
        })
        await ctx.prisma.attendanceRecord.create({
            data: {
                sessionId: session.id,
                workspaceId,
                userId,
                markedById,
                markedAt: at,
            },
        })
    }

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek: 1,
        })
        const { user: a } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: b } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: c } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.groupMember.create({
            data: { groupId: group.id, userId: a.id },
        })
        for (const d of [100, 40, 20]) {
            await visit(workspace.id, group.id, a.id, owner.id, d)
        }
        for (const d of [110, 25]) {
            await visit(workspace.id, group.id, b.id, owner.id, d)
        }
        // C is fine and keeps the club "active" (someone was marked recently).
        for (const d of [120, 1]) {
            await visit(workspace.id, group.id, c.id, owner.id, d)
        }
        const ownerActor = await signIn(ctx, owner.email)
        const coachActor = await signIn(ctx, coach.email)
        return { workspace, owner, coach, group, a, b, c, ownerActor, coachActor }
    }

    const list = (workspaceId: string, auth: [string, string], query = '') =>
        ctx
            .http()
            .get(`/workspaces/${workspaceId}/at-risk-members${query}`)
            .set(...auth)

    it('lets the owner see everyone who is slipping away', async () => {
        const { workspace, ownerActor, a, b } = await setup()
        const res = await list(workspace.id, ownerActor.auth)
        expect(res.status).toBe(200)
        expect(res.body.data.map((m: { userId: string }) => m.userId).sort()).toEqual(
            [a.id, b.id].sort(),
        )
        for (const m of res.body.data) {
            expect(m.reason).toBe('absent')
            expect(m.snoozed).toBe(false)
        }
        expect(res.body.summary).toMatchObject({ total: 2, absent: 2, snoozed: 0 })
    })

    it('shows a coach only the members of their own groups', async () => {
        const { workspace, coachActor, a, group } = await setup()
        const res = await list(workspace.id, coachActor.auth)
        expect(res.status).toBe(200)
        expect(res.body.data.map((m: { userId: string }) => m.userId)).toEqual([a.id])
        expect(res.body.data[0].groups.map((g: { id: string }) => g.id)).toEqual([group.id])
    })

    it('refuses a coach logging a contact for a member outside their groups', async () => {
        const { workspace, coachActor, b } = await setup()
        const res = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/at-risk-members/${b.id}/contacts`)
            .set(...coachActor.auth)
            .send({})
        expect(res.status).toBe(403)
        expect(await ctx.prisma.memberRetentionContact.count()).toBe(0)
    })

    it('hides a member for two weeks after a coach logs a contact', async () => {
        const { workspace, coachActor, a, coach } = await setup()
        const post = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/at-risk-members/${a.id}/contacts`)
            .set(...coachActor.auth)
            .send({ note: 'позвонил, вернётся' })
        expect(post.status).toBe(201)
        expect(post.body).toMatchObject({
            userId: a.id,
            note: 'позвонил, вернётся',
            reason: 'absent',
            signals: ['absent'],
        })

        const row = await ctx.prisma.memberRetentionContact.findFirstOrThrow({
            where: { userId: a.id },
        })
        expect(row.signals).toEqual(['absent'])
        expect(row.contactedById).toBe(coach.id)

        const res = await list(workspace.id, coachActor.auth)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0]).toMatchObject({ userId: a.id, snoozed: true })
        expect(res.body.summary).toMatchObject({ total: 0, snoozed: 1 })
    })

    it('refuses a plain member', async () => {
        const { workspace, a } = await setup()
        const memberActor = await signIn(ctx, a.email)
        const res = await list(workspace.id, memberActor.auth)
        expect(res.status).toBe(403)
    })

    it('404s on an unknown group filter', async () => {
        const { workspace, ownerActor } = await setup()
        const res = await list(workspace.id, ownerActor.auth, `?groupId=${randomUUID()}`)
        expect(res.status).toBe(404)
    })
})
