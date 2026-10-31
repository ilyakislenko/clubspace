import { scheduledOccurrenceKey } from '../../../server/src/features/attendance/attendance-utils'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createUser,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// 2030-01-07 is a Monday.
const FROM = '2030-01-07'
const TO = '2030-01-13'

// «Мой день во всех клубах»: one person in a Moscow club and a Novosibirsk
// club sees both clubs' classes in one list, each at its own wall-clock time,
// plus events, drop-ins and personal trainings, every item tagged with its club.
describe('cross-club agenda', () => {
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

    const agenda = (actor: { auth: [string, string] }, from = FROM, to = TO) =>
        ctx.http().get('/me/agenda').query({ from, to }).set(...actor.auth)

    const clubIn = async (name: string, timezone: string, memberId: string) => {
        const { workspace, owner } = await createWorkspace(ctx, { name })
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { timezone },
        })
        // No gym zone: the club's own zone applies.
        const { group, slot } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek: 1,
            startTime: '19:00',
            durationMin: 60,
            gymTimezone: null,
            name: `${name} group`,
        })
        await addMember(ctx, { workspaceId: workspace.id, userId: memberId })
        await ctx.prisma.groupMember.create({
            data: { groupId: group.id, userId: memberId },
        })
        return { workspace, owner, group, slot }
    }

    it('merges two clubs in two timezones, sorted, with events and drop-ins', async () => {
        const me = await createUser(ctx, { email: 'me@example.com' })
        const msk = await clubIn('Moscow Club', 'Europe/Moscow', me.id)
        const nsk = await clubIn('Novosibirsk Club', 'Asia/Novosibirsk', me.id)

        // A class of another group in Moscow, booked as a drop-in on Wednesday.
        const other = await createGroupWithSlot(ctx, {
            workspaceId: msk.workspace.id,
            coachUserId: msk.owner.id,
            dayOfWeek: 3,
            startTime: '08:00',
            durationMin: 60,
            gymTimezone: null,
            name: 'Open mat',
        })
        await ctx.prisma.dropInBooking.create({
            data: {
                workspaceId: msk.workspace.id,
                userId: me.id,
                groupId: other.group.id,
                slotId: other.slot.id,
                sessionDate: new Date('2030-01-09T00:00:00Z'),
                occurrenceKey: scheduledOccurrenceKey(other.slot.id, '2030-01-09'),
            },
        })
        // A Novosibirsk seminar on Saturday, and a cancelled Moscow Monday.
        await ctx.prisma.workspaceEvent.create({
            data: {
                workspaceId: nsk.workspace.id,
                title: 'Семинар',
                startAt: new Date('2030-01-12T05:00:00Z'),
                endAt: new Date('2030-01-12T08:00:00Z'),
                timezone: 'Asia/Novosibirsk',
                createdById: nsk.owner.id,
            },
        })
        await ctx.prisma.scheduleException.create({
            data: {
                groupId: msk.group.id,
                fromDate: new Date('2030-01-07T00:00:00Z'),
                untilDate: new Date('2030-01-07T00:00:00Z'),
                reason: 'Праздник',
            },
        })

        const actor = await signIn(ctx, me.email)
        const res = await agenda(actor).expect(200)
        const rows = res.body.items.map(
            (i: Record<string, unknown>) => [
                i.kind,
                i.workspaceName,
                i.startAt,
                i.timezone,
                i.cancelled,
            ],
        )
        expect(rows).toEqual([
            // Monday 19:00 in Novosibirsk (UTC+7) comes before 19:00 in Moscow (UTC+3).
            ['class', 'Novosibirsk Club', '2030-01-07T12:00:00.000Z', 'Asia/Novosibirsk', false],
            ['class', 'Moscow Club', '2030-01-07T16:00:00.000Z', 'Europe/Moscow', true],
            ['dropIn', 'Moscow Club', '2030-01-09T05:00:00.000Z', 'Europe/Moscow', false],
            ['event', 'Novosibirsk Club', '2030-01-12T05:00:00.000Z', 'Asia/Novosibirsk', false],
        ])
        expect(res.body.items[1]).toMatchObject({
            workspaceId: msk.workspace.id,
            cancellationReason: 'Праздник',
            groupId: msk.group.id,
            occurrenceId: `${msk.slot.id}:2030-01-07`,
            myRole: 'member',
        })
    })

    it('leaves out a club whose access lapsed and caps the window at 14 days', async () => {
        const me = await createUser(ctx, { email: 'me@example.com' })
        const live = await clubIn('Live Club', 'Europe/Moscow', me.id)
        const lapsed = await clubIn('Lapsed Club', 'Europe/Moscow', me.id)
        await ctx.prisma.workspaceMember.update({
            where: {
                userId_workspaceId: { userId: me.id, workspaceId: lapsed.workspace.id },
            },
            data: { accessUntil: new Date('2020-01-01T00:00:00Z') },
        })

        const actor = await signIn(ctx, me.email)
        const res = await agenda(actor).expect(200)
        expect(
            [...new Set(res.body.items.map((i: { workspaceId: string }) => i.workspaceId))],
        ).toEqual([live.workspace.id])

        await agenda(actor, '2030-01-01', '2030-01-20').expect(400)
    })

    it('shows the coach the classes they run, marked as coach', async () => {
        const me = await createUser(ctx, { email: 'coach@example.com' })
        const { workspace } = await createWorkspace(ctx, { name: 'Club' })
        await addMember(ctx, { workspaceId: workspace.id, userId: me.id })
        await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: me.id,
            dayOfWeek: 2,
            gymTimezone: 'Asia/Tomsk',
        })
        const actor = await signIn(ctx, me.email)
        const res = await agenda(actor).expect(200)
        expect(res.body.items).toHaveLength(1)
        expect(res.body.items[0]).toMatchObject({
            kind: 'class',
            myRole: 'coach',
            timezone: 'Asia/Tomsk',
            date: '2030-01-08',
        })
    })

    it('needs a signed-in caller', async () => {
        await ctx.http().get('/me/agenda').query({ from: FROM, to: TO }).expect(401)
    })
})
