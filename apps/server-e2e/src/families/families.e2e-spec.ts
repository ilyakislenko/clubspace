import { signIn, type Actor } from '../support/actors'
import {
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Join-code alphabet has no I/L/O/0/1.
const CODE = 'KDSB2345'

// Families end to end: a parent adds a child profile (no login), joins a club
// for it by code and then acts for it with X-Act-As — against the real guards,
// so "only your own child, only member routes" is proven on the wire.
describe('families: guardians acting for their children', () => {
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

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            name: 'Kids BJJ',
        })
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { joinAutoApprove: true },
        })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: workspace.id, code: CODE },
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek: 2,
            name: 'Дети 6–9',
        })
        const ownerActor = await signIn(ctx, owner.email as string)
        return { workspace, group, ownerActor }
    }

    const actAs = (dependentId: string): [string, string] => [
        'X-Act-As',
        dependentId,
    ]

    const addChild = async (guardian: Actor) =>
        (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...guardian.auth)
                .send({
                    firstname: 'Миша',
                    lastname: 'Иванов',
                    dateOfBirth: '2018-05-04',
                    consent: true,
                })
                .expect(201)
        ).body as { id: string; status: string }

    const today = () => new Date().toISOString().slice(0, 10)
    const inDays = (n: number) =>
        new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

    it('guardian joins a club for the child, sees its schedule and freezes its abonement', async () => {
        const { workspace, ownerActor } = await club()
        const parent = await signIn(ctx, 'parent@example.com')

        const child = await addChild(parent)
        expect(child.status).toBe('ACTIVE')
        const kid = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: child.id },
        })
        expect(kid.email).toBeNull()

        // Join by code, as the child.
        const joined = await ctx
            .http()
            .post('/workspaces/join')
            .set(...parent.auth)
            .set(...actAs(child.id))
            .send({ code: CODE })
            .expect(201)
        expect(joined.body).toMatchObject({
            status: 'active',
            workspaceId: workspace.id,
        })
        // The child is the member; the parent is not.
        expect(
            await ctx.prisma.workspaceMember.findMany({
                where: { workspaceId: workspace.id, userId: { in: [child.id, parent.userId] } },
                select: { userId: true, status: true },
            }),
        ).toEqual([{ userId: child.id, status: 'ACTIVE' }])

        // The child's clubs, through the profile switcher.
        const clubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set(...parent.auth)
            .set(...actAs(child.id))
            .send({})
            .expect(201)
        expect(clubs.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toEqual([
            workspace.id,
        ])

        // The roster shows the child with its guardian's contacts.
        const roster = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .expect(200)
        const row = roster.body.data.find(
            (m: { userId: string }) => m.userId === child.id,
        )
        expect(row).toMatchObject({
            email: null,
            firstname: 'Миша',
            isDependent: true,
            guardians: [
                {
                    userId: parent.userId,
                    email: 'parent@example.com',
                    relation: 'PARENT',
                    confirmed: true,
                },
            ],
        })

        // Schedule: the parent alone is not a member; acting for the child is.
        const range = `from=${today()}&to=${inDays(13)}`
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule?${range}`)
            .set(...parent.auth)
            .expect(403)
        const schedule = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule?${range}`)
            .set(...parent.auth)
            .set(...actAs(child.id))
            .expect(200)
        expect(
            schedule.body.sessions.some(
                (s: { group: { name: string } }) => s.group.name === 'Дети 6–9',
            ),
        ).toBe(true)

        // The club sells the child an abonement; the parent asks to freeze it.
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            durationDays: 30,
        })
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${child.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const mine = `/workspaces/${workspace.id}/me/subscription`
        const state = await ctx
            .http()
            .get(mine)
            .set(...parent.auth)
            .set(...actAs(child.id))
            .expect(200)
        const asked = await ctx
            .http()
            .post(`${mine}/freeze-requests`)
            .set(...parent.auth)
            .set(...actAs(child.id))
            .send({
                fromDate: state.body.abonements[0].freezeRequestWindow.firstDate,
                days: 7,
                reason: 'Болеет',
            })
            .expect(201)
        expect(asked.body).toMatchObject({ status: 'PENDING', days: 7 })
        const request = await ctx.prisma.subscriptionFreezeRequest.findUniqueOrThrow({
            where: { id: asked.body.id },
        })
        expect(request.userId).toBe(child.id)

        // The write is attributed to the parent in the club's journal.
        expect(
            await ctx.prisma.auditEvent.count({
                where: {
                    action: 'guardian.actAs',
                    actorId: parent.userId,
                    targetId: child.id,
                    workspaceId: workspace.id,
                },
            }),
        ).toBeGreaterThanOrEqual(1)

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/freeze-requests/${asked.body.id}/approve`)
            .set(...ownerActor.auth)
            .send({})
            .expect(201)
        expect(
            await ctx.prisma.subscriptionFreeze.count({
                where: { subscription: { workspaceId: workspace.id } },
            }),
        ).toBe(1)

        // The child's notice lands in the parent's inbox, named after the child.
        const toKid = await ctx.prisma.notification.count({
            where: { userId: child.id },
        })
        expect(toKid).toBe(0)
        const toParent = await ctx.prisma.notification.findMany({
            where: { userId: parent.userId },
            select: { topic: true, metadata: true },
        })
        // The parent's own mail (the sign-in code) sits there too.
        const routed = toParent.filter(
            (n) =>
                (n.metadata as { dependentId?: string } | null)?.dependentId ===
                child.id,
        )
        expect(routed.length).toBeGreaterThanOrEqual(1)
        for (const n of routed) expect(n.topic.startsWith('Миша: ')).toBe(true)
    })

    it('nobody else can act as the child, and act-as never reaches staff or account routes', async () => {
        const { workspace } = await club()
        const parent = await signIn(ctx, 'parent@example.com')
        const child = await addChild(parent)
        await ctx
            .http()
            .post('/workspaces/join')
            .set(...parent.auth)
            .set(...actAs(child.id))
            .send({ code: CODE })
            .expect(201)

        const stranger = await signIn(ctx, 'stranger@example.com')
        for (const req of [
            ctx.http().get(`/workspaces/${workspace.id}/me/subscription`),
            ctx.http().get(`/workspaces/${workspace.id}/schedule?from=${today()}&to=${inDays(6)}`),
            ctx.http().post('/get-my-workspaces').send({}),
        ]) {
            const res = await req.set(...stranger.auth).set(...actAs(child.id))
            expect(res.status).toBe(403)
        }
        // The stranger's own guardian routes don't see the child either.
        await ctx
            .http()
            .delete(`/me/dependents/${child.id}`)
            .set(...stranger.auth)
            .expect(404)

        // Even the parent: staff-only routes refuse act-as…
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...parent.auth)
            .set(...actAs(child.id))
            .expect(403)
        // …and an account route refuses it instead of running for the parent.
        await ctx
            .http()
            .delete('/me')
            .set(...parent.auth)
            .set(...actAs(child.id))
            .expect(403)
        const parentRow = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: parent.userId },
        })
        expect(parentRow.status).toBe('ACTIVE')
    })

    it('a club adds a child; the named parent confirms in the app before acting for it', async () => {
        const { workspace, group, ownerActor } = await club()

        const added = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/dependents`)
            .set(...ownerActor.auth)
            .send({
                firstname: 'Аня',
                dateOfBirth: '2017-09-01',
                guardianEmail: 'new-parent@example.com',
                groupId: group.id,
            })
            .expect(201)
        expect(added.body).toMatchObject({
            guardianIsNew: true,
            emailSent: true,
            groupId: group.id,
        })
        const childId: string = added.body.dependentId
        await ctx.mail.waitFor(
            (m) =>
                m.to === 'new-parent@example.com' &&
                m.html.includes('Аня') &&
                m.html.includes('Kids BJJ'),
        )

        const parent = await signIn(ctx, 'new-parent@example.com')
        const before = await ctx
            .http()
            .get('/me/dependents')
            .set(...parent.auth)
            .expect(200)
        expect(before.body.data).toEqual([
            expect.objectContaining({
                id: childId,
                status: 'PENDING',
                consentAt: null,
                invitedBy: { workspaceId: workspace.id, name: 'Kids BJJ' },
                clubs: [{ workspaceId: workspace.id, name: 'Kids BJJ' }],
            }),
        ])

        // No acting for the child before the parent confirms.
        const range = `from=${today()}&to=${inDays(6)}`
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule?${range}`)
            .set(...parent.auth)
            .set(...actAs(childId))
            .expect(403)

        const confirmed = await ctx
            .http()
            .post(`/me/dependents/${childId}/confirm`)
            .set(...parent.auth)
            .send({ consent: true })
            .expect(200)
        expect(confirmed.body.status).toBe('ACTIVE')
        expect(confirmed.body.consentVersion).toEqual(expect.any(String))

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule?${range}`)
            .set(...parent.auth)
            .set(...actAs(childId))
            .expect(200)

        const roster = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(
            roster.body.data.find((m: { userId: string }) => m.userId === childId)
                .guardians,
        ).toEqual([
            expect.objectContaining({
                email: 'new-parent@example.com',
                confirmed: true,
            }),
        ])
    })

    it('deleting the child purges it like an account deletion', async () => {
        const { workspace } = await club()
        const parent = await signIn(ctx, 'parent@example.com')
        const child = await addChild(parent)
        await ctx
            .http()
            .post('/workspaces/join')
            .set(...parent.auth)
            .set(...actAs(child.id))
            .send({ code: CODE })
            .expect(201)

        // The last parent can't just walk away from the child.
        await ctx
            .http()
            .delete(`/me/dependents/${child.id}/guardianship`)
            .set(...parent.auth)
            .expect(400)

        await ctx
            .http()
            .delete(`/me/dependents/${child.id}`)
            .set(...parent.auth)
            .expect(200, { status: 'deleted' })

        const kid = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: child.id },
        })
        expect(kid).toMatchObject({
            status: 'DELETED',
            email: null,
            firstname: null,
            dateOfBirth: null,
        })
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { workspaceId: workspace.id, userId: child.id },
            }),
        ).toBe(0)
        expect(await ctx.prisma.guardianship.count()).toBe(0)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/me/subscription`)
            .set(...parent.auth)
            .set(...actAs(child.id))
            .expect(403)
    })
})
