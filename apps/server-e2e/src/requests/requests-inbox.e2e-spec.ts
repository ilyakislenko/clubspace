import { randomUUID } from 'node:crypto'

import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { Actor, signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR = 3600_000
const DAY = 24 * HOUR

// Wall-clock in the club's zone, a few days ahead: in the future whatever the zone.
const at = (daysAhead: number, hhmm = '10:00') =>
    `${new Date(Date.now() + daysAhead * DAY).toISOString().slice(0, 10)}T${hhmm}`

type OpenRequest = {
    id: string
    kind: 'join' | 'freeze' | 'personal' | 'video'
    requestId: string
    createdAt: string
    member: { userId: string; name: string }
    join: { roleName: string } | null
    freeze: { days: number; planName: string } | null
    personal: { coach: { userId: string }; options: Array<{ id: string }> } | null
    video: { title: string; clipStatus: string } | null
}
type Inbox = {
    data: OpenRequest[]
    total: number
    curPage: number
    perPage: number
    counts: { join: number; freeze: number; personal: number; video: number; total: number }
    kinds: string[]
}

// «Заявки»: one list of what members asked the club for, scoped to what the
// viewer may decide, against real Postgres — the four where-builders, the
// merge order and the decisions through the existing endpoints.
describe('requests inbox', () => {
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

    const inbox = async (
        workspaceId: string,
        actor: Actor,
        query: Record<string, string | number> = {},
    ): Promise<Inbox> =>
        (
            await ctx
                .http()
                .get(`/workspaces/${workspaceId}/requests`)
                .query(query)
                .set(...actor.auth)
                .expect(200)
        ).body

    const backdate = async (
        model: 'workspaceMember' | 'subscriptionFreezeRequest' | 'personalTrainingRequest' | 'videoReviewRequest',
        id: string,
        hoursAgo: number,
    ) => {
        const createdAt = new Date(Date.now() - hoursAgo * HOUR)
        // One shape for the four models; Prisma's delegates don't unify.
        const delegate = ctx.prisma[model] as unknown as {
            update: (a: { where: { id: string }; data: { createdAt: Date } }) => Promise<unknown>
        }
        await delegate.update({ where: { id }, data: { createdAt } })
    }

    // One club: a pending student and a pending coach applicant, a freeze
    // request, a personal request to the plain coach (and one to another
    // coach) and an open video review. Every member trains in the coach's group.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        const { user: headCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { user: otherCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek: 2,
        })
        const student = async () => {
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            await ctx.prisma.groupMember.create({ data: { groupId: group.id, userId: user.id } })
            return user
        }

        const { member: applicantRow, user: applicant } = await addMember(ctx, {
            workspaceId: workspace.id,
            status: 'INVITED',
        })
        const { member: staffApplicantRow, user: staffApplicant } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
            status: 'INVITED',
        })

        // Freeze: an abonement, then the member asks in the window the server offers.
        const freezer = await student()
        const plan = await createPlan(ctx, { workspaceId: workspace.id, name: 'Абонемент 8' })
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${freezer.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const freezerActor = await signIn(ctx, freezer.email)
        const state = (
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/me/subscription`)
                .set(...freezerActor.auth)
                .expect(200)
        ).body
        const freeze = (
            await ctx
                .http()
                .post(`/workspaces/${workspace.id}/me/subscription/freeze-requests`)
                .set(...freezerActor.auth)
                .send({
                    fromDate: state.abonements[0].freezeRequestWindow.firstDate,
                    days: 7,
                    reason: 'Травма',
                })
                .expect(201)
        ).body as { id: string }

        // Personal: both coaches offer; one member asks each.
        const coachActor = await signIn(ctx, coach.email)
        const otherCoachActor = await signIn(ctx, otherCoach.email)
        for (const actor of [coachActor, otherCoachActor]) {
            await ctx
                .http()
                .put(`/workspaces/${workspace.id}/personal-trainings/offer`)
                .set(...actor.auth)
                .send({ enabled: true })
                .expect(200)
        }
        const trainee = await student()
        const traineeActor = await signIn(ctx, trainee.email)
        const askPersonal = async (coachId: string) =>
            (
                await ctx
                    .http()
                    .post(`/workspaces/${workspace.id}/personal-trainings`)
                    .set(...traineeActor.auth)
                    .send({
                        coachId,
                        options: [
                            { startAt: at(3), durationMin: 60 },
                            { startAt: at(4), durationMin: 60 },
                        ],
                    })
                    .expect(201)
            ).body as { id: string; options: Array<{ id: string }> }
        const personal = await askPersonal(coach.id)
        const otherPersonal = await askPersonal(otherCoach.id)

        // Video: an uploaded clip is files the suite doesn't have; the rows are
        // what the inbox reads.
        const filmer = await student()
        const clipId = randomUUID()
        await ctx.prisma.reviewClip.create({
            data: {
                id: clipId,
                workspaceId: workspace.id,
                ownerUserId: filmer.id,
                status: 'ready',
                rawBucket: 'bucket',
                rawKey: `raw/review/${clipId}/source`,
                hlsBucket: 'bucket',
                duration: 42,
            },
        })
        const video = await ctx.prisma.videoReviewRequest.create({
            data: {
                workspaceId: workspace.id,
                clipId,
                memberUserId: filmer.id,
                title: 'Спарринг',
            },
        })

        // Waited longest first: applicant, freeze, personal, other personal,
        // video, staff applicant.
        await backdate('workspaceMember', applicantRow.id, 6)
        await backdate('subscriptionFreezeRequest', freeze.id, 5)
        await backdate('personalTrainingRequest', personal.id, 4)
        await backdate('personalTrainingRequest', otherPersonal.id, 3)
        await backdate('videoReviewRequest', video.id, 2)
        await backdate('workspaceMember', staffApplicantRow.id, 1)

        return {
            workspace,
            owner,
            ownerActor,
            headCoachActor: await signIn(ctx, headCoach.email),
            coach,
            coachActor,
            applicant,
            staffApplicant,
            freeze,
            personal,
            otherPersonal,
            video,
            traineeActor,
        }
    }
    type Setup = Awaited<ReturnType<typeof setup>>

    const ids = (s: Setup) => ({
        applicant: `join:${s.applicant.id}`,
        staffApplicant: `join:${s.staffApplicant.id}`,
        freeze: `freeze:${s.freeze.id}`,
        personal: `personal:${s.personal.id}`,
        otherPersonal: `personal:${s.otherPersonal.id}`,
        video: `video:${s.video.id}`,
    })

    // Row ids carry the membership id for joins; compare by what decides them.
    const keys = (body: Inbox) => body.data.map((r) => `${r.kind}:${r.requestId}`)

    it('owner sees every kind, oldest first, with matching counts', async () => {
        const s = await setup()
        const body = await inbox(s.workspace.id, s.ownerActor)
        const k = ids(s)
        expect(keys(body)).toEqual([
            k.applicant,
            k.freeze,
            k.personal,
            k.otherPersonal,
            k.video,
            k.staffApplicant,
        ])
        expect(body.kinds).toEqual(['join', 'freeze', 'personal', 'video'])
        expect(body.counts).toEqual({ join: 2, freeze: 1, personal: 2, video: 1, total: 6 })
        expect(body).toMatchObject({ total: 6, curPage: 1, perPage: 50 })
        const byKind = Object.fromEntries(body.data.map((r) => [r.requestId, r]))
        expect(byKind[s.staffApplicant.id].join).toEqual({ roleName: 'coach' })
        expect(byKind[s.freeze.id].freeze).toMatchObject({ days: 7, planName: 'Абонемент 8' })
        expect(byKind[s.personal.id].personal?.options).toHaveLength(2)
        expect(byKind[s.video.id].video).toMatchObject({ title: 'Спарринг', clipStatus: 'ready' })
    })

    it('head coach sees all kinds but a pending staff applicant', async () => {
        const s = await setup()
        const body = await inbox(s.workspace.id, s.headCoachActor)
        expect(body.kinds).toEqual(['join', 'freeze', 'personal', 'video'])
        expect(body.counts).toEqual({ join: 1, freeze: 1, personal: 2, video: 1, total: 5 })
        expect(keys(body)).not.toContain(ids(s).staffApplicant)
        // Rejecting that applicant is not theirs either (approve's rule).
        const res = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${s.staffApplicant.id}/reject`)
            .set(...s.headCoachActor.auth)
            .send({})
        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(/может только владелец или администратор клуба/)
        expect(
            (await ctx.prisma.workspaceMember.findFirstOrThrow({ where: { userId: s.staffApplicant.id } }))
                .status,
        ).toBe('INVITED')
    })

    it('plain coach sees own-group freeze and video, own personal request, no join', async () => {
        const s = await setup()
        const body = await inbox(s.workspace.id, s.coachActor)
        const k = ids(s)
        expect(body.kinds).toEqual(['freeze', 'personal', 'video'])
        expect(keys(body)).toEqual([k.freeze, k.personal, k.video])
        expect(body.counts).toEqual({ join: 0, freeze: 1, personal: 1, video: 1, total: 3 })
    })

    it('a student is refused', async () => {
        const s = await setup()
        await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/requests`)
            .set(...s.traineeActor.auth)
            .expect(403)
    })

    it('deciding through the existing endpoints drops the row and the count', async () => {
        const s = await setup()
        const ws = s.workspace.id
        const total = async () => (await inbox(ws, s.ownerActor, { perPage: 1 })).counts

        await ctx
            .http()
            .post(`/workspaces/${ws}/freeze-requests/${s.freeze.id}/approve`)
            .set(...s.coachActor.auth)
            .send({})
            .expect(201)
        expect(await total()).toMatchObject({ freeze: 0, total: 5 })

        await ctx
            .http()
            .post(`/workspaces/${ws}/personal-trainings/${s.personal.id}/accept`)
            .set(...s.coachActor.auth)
            .send({ optionId: s.personal.options[0].id })
            .expect(201)
        expect(await total()).toMatchObject({ personal: 1, total: 4 })

        await ctx
            .http()
            .post(`/workspaces/${ws}/members/${s.applicant.id}/reject`)
            .set(...s.ownerActor.auth)
            .expect(201)
        expect(await total()).toMatchObject({ join: 1, total: 3 })

        await ctx
            .http()
            .put(`/workspaces/${ws}/video-reviews/${s.video.id}/status`)
            .set(...s.coachActor.auth)
            .send({ status: 'answered' })
            .expect(200)
        const after = await inbox(ws, s.ownerActor)
        expect(keys(after)).toEqual([ids(s).otherPersonal, ids(s).staffApplicant])
        expect(after.counts).toEqual({ join: 1, freeze: 0, personal: 1, video: 0, total: 2 })

        // A second decision on the same freeze request is a race, not a repeat.
        const again = await ctx
            .http()
            .post(`/workspaces/${ws}/freeze-requests/${s.freeze.id}/approve`)
            .set(...s.ownerActor.auth)
            .send({})
        expect(again.status).toBe(409)
    })

    it('reject with a comment sends member.join_declined to the applicant', async () => {
        const s = await setup()
        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${s.staffApplicant.id}/reject`)
            .set(...s.ownerActor.auth)
            .send({ comment: '  Набор тренеров закрыт  ' })
            .expect(201)
        // The app rejects without a body; the applicant still hears.
        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${s.applicant.id}/reject`)
            .set(...s.ownerActor.auth)
            .expect(201)

        const notice = async (userId: string) =>
            (await ctx.prisma.notification.findMany({ where: { userId } })).filter(
                (n) => (n.metadata as { kind?: string } | null)?.kind === 'member.join_declined',
            )
        const [withComment] = await notice(s.staffApplicant.id)
        expect(withComment).toMatchObject({
            topic: 'Заявка в клуб «Test Club» отклонена',
            message: 'Набор тренеров закрыт',
        })
        expect(withComment.metadata).toMatchObject({ workspaceId: s.workspace.id })
        const [plain] = await notice(s.applicant.id)
        expect(plain.message).toBe('Если это ошибка — свяжитесь с клубом.')

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { action: 'member.rejectPending', targetId: s.staffApplicant.id },
        })
        expect(audit.metadata).toMatchObject({ comment: 'Набор тренеров закрыт' })

        // Decided already: nothing to reject, nobody notified twice.
        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${s.applicant.id}/reject`)
            .set(...s.ownerActor.auth)
            .expect(404)
        expect(await notice(s.applicant.id)).toHaveLength(1)
    })

    it('a personal request whose times have passed is not listed', async () => {
        const s = await setup()
        await ctx.prisma.personalTrainingOption.updateMany({
            where: { requestId: s.personal.id },
            data: { startAt: new Date(Date.now() - HOUR) },
        })
        const body = await inbox(s.workspace.id, s.coachActor)
        expect(keys(body)).not.toContain(ids(s).personal)
        expect(body.counts.personal).toBe(0)
        // The other coach's request still waits for the owner.
        expect((await inbox(s.workspace.id, s.ownerActor)).counts.personal).toBe(1)
    })

    it('kind filter and paging', async () => {
        const s = await setup()
        const ws = s.workspace.id
        const k = ids(s)

        const joins = await inbox(ws, s.ownerActor, { kind: 'join' })
        expect(keys(joins)).toEqual([k.applicant, k.staffApplicant])
        expect(joins.total).toBe(2)
        expect(joins.counts.total).toBe(6)

        const page2 = await inbox(ws, s.ownerActor, { curPage: 2, perPage: 2 })
        expect(keys(page2)).toEqual([k.personal, k.otherPersonal])
        expect(page2).toMatchObject({ total: 6, curPage: 2, perPage: 2 })
        const page3 = await inbox(ws, s.ownerActor, { curPage: 3, perPage: 2 })
        expect(keys(page3)).toEqual([k.video, k.staffApplicant])

        const deep = await ctx
            .http()
            .get(`/workspaces/${ws}/requests`)
            .query({ curPage: 11, perPage: 100 })
            .set(...s.ownerActor.auth)
        expect(deep.status).toBe(400)
        expect(deep.body.message).toBe('Слишком далеко — выберите вид заявки')

        await ctx
            .http()
            .get(`/workspaces/${ws}/requests`)
            .query({ perPage: 101 })
            .set(...s.ownerActor.auth)
            .expect(400)
    })

    it('subscription section off hides freeze requests', async () => {
        const s = await setup()
        await ctx.prisma.workspace.update({
            where: { id: s.workspace.id },
            data: { subscriptionEnabled: false },
        })
        const body = await inbox(s.workspace.id, s.ownerActor)
        expect(body.kinds).toEqual(['join', 'personal', 'video'])
        expect(body.counts).toMatchObject({ freeze: 0, total: 5 })
        expect(body.data.map((r) => r.kind)).not.toContain('freeze')

        await ctx.prisma.workspace.update({
            where: { id: s.workspace.id },
            data: { videosEnabled: false },
        })
        const noVideo = await inbox(s.workspace.id, s.ownerActor)
        expect(noVideo.kinds).toEqual(['join', 'personal'])
        expect(noVideo.counts).toMatchObject({ freeze: 0, video: 0, total: 4 })
    })

    it('the applicant list dates a request by when they asked', async () => {
        const s = await setup()
        const row = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { userId: s.applicant.id, workspaceId: s.workspace.id },
        })
        const list = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/pending-users`)
            .set(...s.ownerActor.auth)
            .expect(200)
        const mine = list.body.data.find((p: { userId: string }) => p.userId === s.applicant.id)
        expect(mine.createdAt).toBe(row.createdAt.toISOString())
        expect(mine.createdAt).not.toBe(s.applicant.createdAt.toISOString())
    })
})
