import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// An announcement addressed to groups («Аттестация взрослых») against the
// real guards, handlers and database: only the students of those groups (a
// child through its parent acting for it), their coaches and the staff see it
// in the feed and get the push; a direction manager addresses only groups of
// the directions they run; club-wide and direction announcements keep working.
describe('announcements addressed to groups', () => {
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

    const ws = (workspaceId: string) => `/workspaces/${workspaceId}`
    const http = () => ctx.http()

    // БЖЖ with an adult and a kids group, ММА with one group. The adult and
    // the ММА student log in themselves; the child is a profile of `parent`.
    // `manager` (coach) runs БЖЖ, `coach` is a plain coach.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const w = workspace.id
        const ownerActor = await signIn(ctx, owner.email)
        const direction = async (name: string) =>
            (
                await http()
                    .post(`${ws(w)}/directions`)
                    .set(...ownerActor.auth)
                    .send({ name })
                    .expect(201)
            ).body.id as string
        const bjj = await direction('БЖЖ')
        const mma = await direction('ММА')
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: w, name: 'Манеж', address: 'ул. Тестовая, 1' },
        })
        const member = async (role = RolesEnum.USER) => {
            const { user } = await addMember(ctx, { workspaceId: w, role })
            return { user, actor: await signIn(ctx, user.email!) }
        }
        const adult = await member()
        const fighter = await member()
        const manager = await member(RolesEnum.COACH)
        const coach = await member(RolesEnum.COACH)

        const parent = await signIn(ctx, 'parent-groups@example.com')
        const child = (
            await http()
                .post('/me/dependents')
                .set(...parent.auth)
                .send({
                    firstname: 'Миша',
                    lastname: 'Иванов',
                    dateOfBirth: '2017-05-04',
                    consent: true,
                })
                .expect(201)
        ).body as { id: string }
        await addMember(ctx, { workspaceId: w, userId: child.id })

        const group = (name: string, directionId: string, memberIds: string[]) =>
            ctx.prisma.group.create({
                data: {
                    workspaceId: w,
                    name,
                    gymId: gym.id,
                    coachId: coach.user.id,
                    directionId,
                    coaches: { create: { userId: coach.user.id, role: 'primary' } },
                    members: { create: memberIds.map((userId) => ({ userId })) },
                },
            })
        const adults = await group('Взрослые', bjj, [adult.user.id])
        const kids = await group('Дети', bjj, [child.id])
        const mmaGroup = await group('ММА вечер', mma, [fighter.user.id])

        await http()
            .post(`${ws(w)}/direction-managers`)
            .set(...ownerActor.auth)
            .send({ directionId: bjj, userId: manager.user.id })
            .expect(201)

        const actAsChild: [string, string] = ['X-Act-As', child.id]
        return {
            w,
            ownerActor,
            bjj,
            adult,
            fighter,
            manager,
            coach,
            parent,
            child,
            actAsChild,
            groups: { adults, kids, mma: mmaGroup },
        }
    }

    const post = (w: string, actor: Actor, body: Record<string, unknown>) =>
        http()
            .post(`${ws(w)}/announcements`)
            .set(...actor.auth)
            .send({ title: 'Объявление', body: 'Текст', publish: true, ...body })

    const feedIds = async (w: string, actor: Actor, actAs?: [string, string]) => {
        const req = http().get(`${ws(w)}/announcements/feed`).set(...actor.auth)
        if (actAs) req.set(...actAs)
        return ((await req.expect(200)).body.data as Array<{ id: string }>).map(
            (a) => a.id,
        )
    }

    const announcementPushes = async (announcementId: string) =>
        (
            await ctx.prisma.notification.findMany({
                select: { userId: true, metadata: true },
            })
        )
            .filter(
                (n) =>
                    (n.metadata as { announcementId?: string } | null)
                        ?.announcementId === announcementId,
            )
            .map((n) => n.userId)
            .sort()

    it('reaches only the groups (feed, a parent acting for the child, push); staff see it', async () => {
        const c = await setup()

        const forAdults = await post(c.w, c.ownerActor, {
            title: 'Аттестация взрослых',
            groupIds: [c.groups.adults.id],
        }).expect(201)
        expect(forAdults.body.direction).toBeNull()
        expect(forAdults.body.groups).toEqual([
            {
                id: c.groups.adults.id,
                name: 'Взрослые',
                gymName: 'Манеж',
                directionId: c.bjj,
            },
        ])
        const forKids = await post(c.w, c.ownerActor, {
            title: 'Детский турнир',
            groupIds: [c.groups.kids.id],
        }).expect(201)

        const adultsId = forAdults.body.id as string
        const kidsId = forKids.body.id as string
        expect(await feedIds(c.w, c.adult.actor)).toEqual([adultsId])
        expect(await feedIds(c.w, c.parent, c.actAsChild)).toEqual([kidsId])
        expect(await feedIds(c.w, c.fighter.actor)).toEqual([])
        // The coach of the groups and the owner see both.
        expect((await feedIds(c.w, c.coach.actor)).sort()).toEqual(
            [adultsId, kidsId].sort(),
        )
        expect((await feedIds(c.w, c.ownerActor)).sort()).toEqual(
            [adultsId, kidsId].sort(),
        )

        // Push: the adult (and the staff), not the child's parent or ММА; the
        // kids one goes on to the parent.
        const adultsPushes = await announcementPushes(adultsId)
        expect(adultsPushes).toContain(c.adult.user.id)
        expect(adultsPushes).not.toContain(c.parent.userId)
        expect(adultsPushes).not.toContain(c.fighter.user.id)
        const kidsPushes = await announcementPushes(kidsId)
        expect(kidsPushes).toContain(c.parent.userId)
        expect(kidsPushes).not.toContain(c.adult.user.id)
        expect(kidsPushes).not.toContain(c.fighter.user.id)
    })

    it('club-wide and direction announcements work as before', async () => {
        const c = await setup()
        const clubWide = await post(c.w, c.ownerActor, {}).expect(201)
        const ofBjj = await post(c.w, c.ownerActor, { directionId: c.bjj }).expect(201)
        expect(clubWide.body.groups).toEqual([])

        expect((await feedIds(c.w, c.adult.actor)).sort()).toEqual(
            [clubWide.body.id, ofBjj.body.id].sort(),
        )
        expect((await feedIds(c.w, c.parent, c.actAsChild)).sort()).toEqual(
            [clubWide.body.id, ofBjj.body.id].sort(),
        )
        expect(await feedIds(c.w, c.fighter.actor)).toEqual([clubWide.body.id])
    })

    it('a direction manager addresses only groups of their directions', async () => {
        const c = await setup()
        const mine = await post(c.w, c.manager.actor, {
            groupIds: [c.groups.adults.id, c.groups.kids.id],
        }).expect(201)
        await post(c.w, c.manager.actor, { groupIds: [c.groups.mma.id] }).expect(403)
        await post(c.w, c.manager.actor, {
            groupIds: [c.groups.adults.id, c.groups.mma.id],
        }).expect(403)
        // A plain coach can't post, even to the groups they coach.
        await post(c.w, c.coach.actor, { groupIds: [c.groups.adults.id] }).expect(403)
        // Never a direction and groups together.
        await post(c.w, c.ownerActor, {
            directionId: c.bjj,
            groupIds: [c.groups.adults.id],
        }).expect(400)

        // Another club's group is unknown here.
        const other = await createWorkspace(ctx)
        const foreign = await ctx.prisma.group.create({
            data: {
                workspaceId: other.workspace.id,
                name: 'Чужая',
                coachId: other.owner.id,
                coaches: { create: { userId: other.owner.id, role: 'primary' } },
            },
        })
        await post(c.w, c.ownerActor, { groupIds: [foreign.id] }).expect(404)

        // Their list shows it; moving it to an ММА group is refused.
        const list = await http()
            .get(`${ws(c.w)}/announcements`)
            .set(...c.manager.actor.auth)
            .expect(200)
        expect((list.body.data as Array<{ id: string }>).map((a) => a.id)).toEqual([
            mine.body.id,
        ])
        await http()
            .patch(`${ws(c.w)}/announcements/${mine.body.id}`)
            .set(...c.manager.actor.auth)
            .send({ directionId: null, groupIds: [c.groups.mma.id] })
            .expect(403)
        // An admin's announcement for an ММА group stays out of their reach.
        const forMma = await post(c.w, c.ownerActor, {
            groupIds: [c.groups.mma.id],
        }).expect(201)
        await http()
            .delete(`${ws(c.w)}/announcements/${forMma.body.id}`)
            .set(...c.manager.actor.auth)
            .expect(403)
    })
})
