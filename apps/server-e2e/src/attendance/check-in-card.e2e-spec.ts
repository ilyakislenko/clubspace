import { localMinuteInTz } from '../../../server/src/features/attendance/attendance-utils'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Door check-in by the member card QR
// (docs/design/2026-11-26-door-checkin-and-birthdays.md §1): the member reads
// their static signed card, the coach's scan resolves it read-only, and the
// visit is marked through the existing records endpoint — so the pack
// deduction and the undo refund are the mark path's, proven on real Postgres.
describe('check-in card: the coach scans a member card at the door', () => {
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
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Самурай' })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.user.update({
            where: { id: student.id },
            data: { firstname: 'Пётр', lastname: 'Иванов' },
        })
        const { group } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek: 2,
        })
        await ctx.prisma.groupMember.create({
            data: { groupId: group.id, userId: student.id },
        })
        const plan = await createPlan(ctx, { workspaceId: workspace.id, classCount: 8 })
        const ownerActor = await signIn(ctx, owner.email as string)
        const coachActor = await signIn(ctx, coach.email as string)
        const studentActor = await signIn(ctx, student.email as string)
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${student.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        // The coach opens tonight's class from the roster.
        const opened = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/attendance/sessions`)
            .set(...coachActor.auth)
            .send({
                kind: 'adhoc',
                groupId: group.id,
                startAt: localMinuteInTz(new Date(), 'Asia/Tomsk'),
                title: 'Вечерняя',
            })
            .expect(201)
        return {
            workspace,
            owner,
            coach,
            student,
            group,
            ownerActor,
            coachActor,
            studentActor,
            sessionId: opened.body.id as string,
        }
    }

    const lookup = (auth: [string, string], workspaceId: string, sessionId: string, card: string) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/attendance/sessions/${sessionId}/card-lookup`)
            .set(...auth)
            .send({ card })

    const classesRemaining = async (workspaceId: string, userId: string) =>
        (
            await ctx.prisma.subscription.findFirstOrThrow({
                where: { workspaceId, userId, status: 'ACTIVE' },
                select: { classesRemaining: true },
            })
        ).classesRemaining

    it('reads the card, resolves it, marks through records and refunds on undo', async () => {
        const s = await setup()

        // 1. The student reads their card.
        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/check-in-card`)
            .set(...s.studentActor.auth)
            .expect(200)
        expect(mine.body.card).toMatch(new RegExp(`^CS1\\.${s.student.id}\\.[A-Za-z0-9_-]{16}$`))
        expect(mine.body.qrPngDataUrl).toMatch(/^data:image\/png;base64,/)
        expect(mine.body.name).toBe('Пётр Иванов')

        // 2. The coach scans it: resolved, not marked yet. Nothing written.
        const first = await lookup(s.coachActor.auth, s.workspace.id, s.sessionId, mine.body.card).expect(200)
        expect(first.body).toEqual({
            userId: s.student.id,
            name: 'Пётр Иванов',
            photoUrl: null,
            isDependent: false,
            inGroup: true,
            alreadyMarked: false,
        })
        expect(await ctx.prisma.attendanceRecord.count()).toBe(0)
        expect(await classesRemaining(s.workspace.id, s.student.id)).toBe(8)

        // 3. The app marks through the existing endpoint: 8 → 7.
        const marked = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/attendance/sessions/${s.sessionId}/records`)
            .set(...s.coachActor.auth)
            .send({ userIds: [first.body.userId] })
            .expect(201)
        expect(
            marked.body.roster.find((r: { userId: string }) => r.userId === s.student.id),
        ).toMatchObject({ present: true })
        expect(await classesRemaining(s.workspace.id, s.student.id)).toBe(7)
        const record = await ctx.prisma.attendanceRecord.findFirstOrThrow()
        expect(record.markedById).toBe(s.coach.id)

        // 4. A second scan says «Уже отмечен».
        const again = await lookup(s.coachActor.auth, s.workspace.id, s.sessionId, mine.body.card).expect(200)
        expect(again.body.alreadyMarked).toBe(true)

        // 5. «Отменить»: the existing unmark refunds the class.
        await ctx
            .http()
            .delete(`/workspaces/${s.workspace.id}/attendance/sessions/${s.sessionId}/records/${s.student.id}`)
            .set(...s.coachActor.auth)
            .expect(200)
        expect(await classesRemaining(s.workspace.id, s.student.id)).toBe(8)
    })

    it('answers 404 with no name for a member of another club', async () => {
        const s = await setup()
        const { workspace: other } = await createWorkspace(ctx, { name: 'Чужой клуб' })
        const { user: stranger } = await addMember(ctx, { workspaceId: other.id })
        await ctx.prisma.user.update({
            where: { id: stranger.id },
            data: { firstname: 'Чужак' },
        })
        const strangerActor = await signIn(ctx, stranger.email as string)
        const card = (
            await ctx
                .http()
                .get(`/workspaces/${other.id}/me/check-in-card`)
                .set(...strangerActor.auth)
                .expect(200)
        ).body.card as string

        const res = await lookup(s.coachActor.auth, s.workspace.id, s.sessionId, card).expect(404)
        expect(res.body.message).toBe('Этого человека нет в клубе')
        expect(JSON.stringify(res.body)).not.toContain('Чужак')
    })

    it('refuses a forged card (400) and a student scanning (403)', async () => {
        const s = await setup()
        const forged = await lookup(
            s.coachActor.auth,
            s.workspace.id,
            s.sessionId,
            `CS1.${s.student.id}.AAAAAAAAAAAAAAAA`,
        ).expect(400)
        expect(forged.body.message).toBe('Это не карта участника ClubSpace')

        const card = (
            await ctx
                .http()
                .get(`/workspaces/${s.workspace.id}/me/check-in-card`)
                .set(...s.studentActor.auth)
                .expect(200)
        ).body.card as string
        await lookup(s.studentActor.auth, s.workspace.id, s.sessionId, card).expect(403)
    })

    it('refuses a blocked member, naming them', async () => {
        const s = await setup()
        const card = (
            await ctx
                .http()
                .get(`/workspaces/${s.workspace.id}/me/check-in-card`)
                .set(...s.studentActor.auth)
                .expect(200)
        ).body.card as string
        await ctx.prisma.workspaceMember.updateMany({
            where: { workspaceId: s.workspace.id, userId: s.student.id },
            data: { status: 'BLOCKED' },
        })
        const res = await lookup(s.coachActor.auth, s.workspace.id, s.sessionId, card).expect(400)
        expect(res.body.message).toBe('Пётр Иванов не активен в клубе — отметить нельзя')
    })

    it('gives a parent the child card under X-Act-As, and a sport lead the printable one', async () => {
        const s = await setup()
        const parent = await signIn(ctx, 'parent@example.com')
        const child = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...parent.auth)
                .send({ firstname: 'Аня', lastname: 'Петрова', dateOfBirth: '2019-05-04', consent: true })
                .expect(201)
        ).body as { id: string }
        await addMember(ctx, { workspaceId: s.workspace.id, userId: child.id })

        const childCard = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/check-in-card`)
            .set(...parent.auth)
            .set('X-Act-As', child.id)
            .expect(200)
        expect(childCard.body.card.startsWith(`CS1.${child.id}.`)).toBe(true)
        expect(childCard.body.name).toBe('Аня Петрова')

        // The owner prints it from the member card; it is the same card.
        const printed = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${child.id}/check-in-card`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(printed.body.card).toBe(childCard.body.card)
        // A coach is not a sport lead.
        await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${child.id}/check-in-card`)
            .set(...s.coachActor.auth)
            .expect(403)

        // Scanning the child resolves a dependent, a guest of this group.
        const scanned = await lookup(s.coachActor.auth, s.workspace.id, s.sessionId, childCard.body.card).expect(200)
        expect(scanned.body).toMatchObject({ userId: child.id, isDependent: true, inGroup: false })
    })
})
