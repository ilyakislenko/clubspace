import { NotificationProducerService } from '../../../server/src/domains/notifications/services/notification-producer.service'
import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// A child's notices go to its guardians, and each guardian's own settings
// apply to them (docs/design/2026-11-26-parent-pays-for-child.md §3.4–3.5):
// their category opt-out, the child's club mute (set from the child's profile)
// and their own mute of the same club. Mute-exempt kinds (payments, classes)
// still arrive. Real guards, producer and Postgres.
describe('a guardian’s notification settings cover the child', () => {
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

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Kids BJJ' })
        const w = workspace.id
        const ownerActor = await signIn(ctx, owner.email as string)
        const parent = await signIn(ctx, 'parent-prefs@example.com')
        const child = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...parent.auth)
                .send({ firstname: 'Миша', lastname: 'Петров', dateOfBirth: '2017-05-04', consent: true })
                .expect(201)
        ).body as { id: string }
        await addMember(ctx, { workspaceId: w, userId: child.id })
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: w, name: 'Манеж', address: 'ул. Тестовая, 1' },
        })
        const kids = await ctx.prisma.group.create({
            data: {
                workspaceId: w,
                name: 'Дети',
                gymId: gym.id,
                coachId: owner.id,
                members: { create: [{ userId: child.id }] },
            },
        })
        const actAs: [string, string] = ['X-Act-As', child.id]
        return { w, ownerActor, parent, child, kids, actAs }
    }
    type Setup = Awaited<ReturnType<typeof setup>>

    let seq = 0
    // A published announcement to the child's group; the ids of the inboxes
    // it reached.
    const announce = async (s: Setup) => {
        seq += 1
        const res = await ctx
            .http()
            .post(`/workspaces/${s.w}/announcements`)
            .set(...s.ownerActor.auth)
            .send({ title: `Объявление ${seq}`, body: 'Текст', publish: true, groupIds: [s.kids.id] })
            .expect(201)
        const id = res.body.id as string
        return (
            await ctx.prisma.notification.findMany({
                where: { metadata: { path: ['announcementId'], equals: id } },
                select: { userId: true, topic: true, metadata: true },
            })
        ).map((n) => n.userId)
    }

    const setAnnouncements = (s: Setup, enabled: boolean) =>
        ctx
            .http()
            .put('/me/notification-preferences')
            .set(...s.parent.auth)
            .send({ announcementsEnabled: enabled })
            .expect(200)

    // A mute-exempt notice addressed to the child (a pack running out).
    const classesLow = async (s: Setup, refId: string) => {
        await ctx.app.get(NotificationProducerService).notifyUser({
            userId: s.child.id,
            kind: 'classes.low',
            refId,
            topic: 'Осталось 2 занятия',
            message: 'm',
            workspaceId: s.w,
        })
        return (
            await ctx.prisma.notification.findMany({
                where: { metadata: { path: ['kind'], equals: 'classes.low' }, userId: s.parent.userId },
            })
        ).length
    }

    it('announcements of the child’s group follow the parent’s «Объявления» switch', async () => {
        const s = await setup()
        // On by default: the parent gets it with the child's name.
        expect(await announce(s)).toEqual([s.parent.userId])
        const first = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: s.parent.userId } })
        expect(first.topic).toBe('Миша: Объявление 1')
        expect(first.metadata).toMatchObject({ dependentId: s.child.id })

        await setAnnouncements(s, false)
        expect(await announce(s)).toEqual([])
        // The other channels of the parent still work.
        expect(await classesLow(s, 'low-1')).toBe(1)

        await setAnnouncements(s, true)
        expect(await announce(s)).toEqual([s.parent.userId])
    })

    it('the child’s club mute, set from the child’s profile, silences chatter but not classes', async () => {
        const s = await setup()
        const muted = await ctx
            .http()
            .patch(`/me/memberships/${s.w}/notifications`)
            .set(...s.parent.auth)
            .set(...s.actAs)
            .send({ muted: true })
            .expect(200)
        expect(muted.body).toEqual({ workspaceId: s.w, notificationsMuted: true })
        expect(
            await ctx.prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: s.w, userId: s.child.id } }),
        ).toMatchObject({ notificationsMuted: true })
        // Recorded as the guardian acting for the child.
        expect(
            await ctx.prisma.auditEvent.findFirst({
                where: { action: 'guardian.actAs', actorId: s.parent.userId, targetId: s.child.id },
            }),
        ).not.toBeNull()
        // The profile switcher reads the child's switch.
        const clubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set(...s.parent.auth)
            .set(...s.actAs)
            .send({})
            .expect(201)
        expect(clubs.body.data).toEqual([
            expect.objectContaining({ workspaceId: s.w, notificationsMuted: true }),
        ])

        expect(await announce(s)).toEqual([])
        expect(await classesLow(s, 'low-2')).toBe(1)

        await ctx
            .http()
            .patch(`/me/memberships/${s.w}/notifications`)
            .set(...s.parent.auth)
            .set(...s.actAs)
            .send({ muted: false })
            .expect(200)
        expect(await announce(s)).toEqual([s.parent.userId])
    })

    it('the parent’s own mute of the club silences the child’s chatter from it too', async () => {
        const s = await setup()
        // The parent trains in the same club, outside the kids' group.
        await addMember(ctx, { workspaceId: s.w, userId: s.parent.userId })
        await ctx
            .http()
            .patch(`/me/memberships/${s.w}/notifications`)
            .set(...s.parent.auth)
            .send({ muted: true })
            .expect(200)
        expect(await announce(s)).toEqual([])
        expect(await classesLow(s, 'low-3')).toBe(1)
    })

    it('another guardian keeps their copy when one parent opts out', async () => {
        const s = await setup()
        const other = await signIn(ctx, 'other-parent-prefs@example.com')
        await ctx.prisma.guardianship.create({
            data: { guardianId: other.userId, dependentId: s.child.id, consentAt: new Date() },
        })
        await setAnnouncements(s, false)
        expect(await announce(s)).toEqual([other.userId])
    })
})
