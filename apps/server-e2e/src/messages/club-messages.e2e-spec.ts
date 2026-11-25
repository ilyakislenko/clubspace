import { localHourInTz } from '../../../server/src/domains/scheduler/clubs-due'
import { RemindersService } from '../../../server/src/domains/scheduler/reminders.service'
import { ExpoPushClient } from '../../../server/src/domains/notifications/services/expo-push.client'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// A fixed-offset zone where it is `hour`:xx right now, so a spec can stand in
// the club's daytime or its night without faking the clock of a whole app
// (Etc/GMT signs are inverted: Etc/GMT-5 is UTC+5).
const zoneAtHour = (hour: number): string => {
    let offset = (hour - new Date().getUTCHours() + 24) % 24
    if (offset > 14) offset -= 24
    return offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

// «Сообщения» against real Postgres, guards, producer and queues
// (docs/design/2026-11-26-broadcast-and-direct-messages.md §9).
describe('club messages', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
        // Devices are real rows; Expo itself is not reached from the suite.
        jest.spyOn(ctx.app.get(ExpoPushClient), 'send').mockImplementation(async (messages) =>
            messages.map((_, i) => ({ status: 'ok' as const, id: `ticket-${i}` })),
        )
        jest.spyOn(ctx.app.get(ExpoPushClient), 'getReceipts').mockResolvedValue({})
    })
    afterAll(async () => {
        jest.restoreAllMocks()
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
    })

    let seq = 0
    const device = (userId: string) =>
        ctx.prisma.firebaseDevice.create({
            data: { userId, token: `ExponentPushToken[e2e-${seq++}]`, timezone: 'Europe/Moscow' },
        })

    // A club in daytime (or `hour`) with its owner signed in.
    const club = async (hour = 12) => {
        const { workspace, owner } = await createWorkspace(ctx, { ownerMembership: false, name: 'Академия' })
        await ctx.prisma.workspace.update({ where: { id: workspace.id }, data: { timezone: zoneAtHour(hour) } })
        const ownerActor = await signIn(ctx, owner.email as string)
        const gym = await ctx.prisma.gym.create({ data: { workspaceId: workspace.id, name: 'Манеж', address: 'ул. 1' } })
        return { w: workspace.id, owner, ownerActor, gymId: gym.id }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const student = async (c: Club, name: string, opts: { device?: boolean } = {}) => {
        const { user, member } = await addMember(ctx, { workspaceId: c.w })
        await ctx.prisma.user.update({ where: { id: user.id }, data: { firstname: name } })
        if (opts.device) await device(user.id)
        return { ...user, memberId: member.id }
    }

    const group = async (c: Club, coachId: string, memberIds: string[], name = 'Взрослые') =>
        ctx.prisma.group.create({
            data: {
                workspaceId: c.w,
                name,
                gymId: c.gymId,
                coachId,
                coaches: { create: [{ userId: coachId, role: 'primary' }] },
                members: { create: memberIds.map((userId) => ({ userId })) },
            },
        })

    const send = (c: Club, actor: Pick<Actor, 'auth'>, body: Record<string, unknown>) =>
        ctx
            .http()
            .post(`/workspaces/${c.w}/messages`)
            .set(...actor.auth)
            .send({ title: 'Сбор', body: 'Тренировка в субботу', ...body })

    const pushRowsFor = (messageId: string) =>
        ctx.prisma.notification.findMany({
            where: { metadata: { path: ['messageId'], equals: messageId }, type: 'PUSH' },
            select: { userId: true, topic: true, metadata: true },
        })

    const recipientsOf = (messageId: string) =>
        ctx.prisma.clubMessageRecipient.findMany({
            where: { messageId },
            select: { userId: true, pushSkip: true, readAt: true, emailedAt: true },
        })

    it('owner sends to unpaid students and they get push and an in-app message', async () => {
        const c = await club()
        const plan = await createPlan(ctx, { workspaceId: c.w })
        const debtor = await student(c, 'Иван', { device: true })
        const paid = await student(c, 'Ольга', { device: true })
        for (const [s, isPaid] of [
            [debtor, false],
            [paid, true],
        ] as const) {
            await ctx.prisma.subscription.create({
                data: {
                    workspaceId: c.w,
                    planId: plan.id,
                    workspaceMemberId: s.memberId,
                    status: 'ACTIVE',
                    startDate: new Date(Date.now() - 3 * DAY),
                    endDate: new Date(Date.now() + 27 * DAY),
                    amountPaid: isPaid ? 400000 : 0,
                    currency: 'RUB',
                    isPaid,
                },
            })
        }

        const preview = await ctx
            .http()
            .post(`/workspaces/${c.w}/messages/preview`)
            .set(...c.ownerActor.auth)
            .send({ segment: 'UNPAID' })
            .expect(200)
        expect(preview.body).toMatchObject({ recipients: 1, withPush: 1, deferredByQuietHours: false })

        const res = await send(c, c.ownerActor, { segment: 'UNPAID', title: 'Напоминаем об оплате' }).expect(201)
        expect(res.body).toMatchObject({
            status: 'SENT',
            segment: 'UNPAID',
            audienceLabel: 'Не оплатили',
            recipientCount: 1,
            pushCount: 1,
        })
        expect(await recipientsOf(res.body.id)).toEqual([
            { userId: debtor.id, pushSkip: null, readAt: null, emailedAt: null },
        ])
        const pushes = await pushRowsFor(res.body.id)
        expect(pushes.map((p) => [p.userId, p.topic])).toEqual([[debtor.id, 'Напоминаем об оплате']])
        expect(pushes[0].metadata).toMatchObject({ kind: 'message.broadcast', workspaceId: c.w })

        const debtorActor = await signIn(ctx, debtor.email as string)
        const mine = await ctx.http().get(`/workspaces/${c.w}/me/messages`).set(...debtorActor.auth).expect(200)
        expect(mine.body).toMatchObject({ total: 1, unreadCount: 1 })
        expect(mine.body.data[0]).toMatchObject({ id: res.body.id, title: 'Напоминаем об оплате', readAt: null })
        const paidActor = await signIn(ctx, paid.email as string)
        const none = await ctx.http().get(`/workspaces/${c.w}/me/messages`).set(...paidActor.auth).expect(200)
        expect(none.body.total).toBe(0)

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'message.send' } })
        expect(audit).toMatchObject({ targetType: 'clubMessage', targetId: res.body.id, actorId: c.owner.id })
        expect(audit.metadata).toMatchObject({ segment: 'UNPAID', isDirect: false, sendAt: expect.any(String) })
    })

    it('coach can message own group but not another group or the unpaid segment', async () => {
        const c = await club()
        const { user: coach } = await addMember(ctx, { workspaceId: c.w, role: RolesEnum.COACH })
        const { user: other } = await addMember(ctx, { workspaceId: c.w, role: RolesEnum.COACH })
        const mine = await student(c, 'Свой')
        const theirs = await student(c, 'Чужой')
        const own = await group(c, coach.id, [mine.id], 'Свои')
        const foreign = await group(c, other.id, [theirs.id], 'Чужие')
        const coachActor = await signIn(ctx, coach.email as string)

        const ok = await send(c, coachActor, { segment: 'GROUPS', groupIds: [own.id] }).expect(201)
        expect(ok.body).toMatchObject({ audienceLabel: 'Группы: Свои', recipientCount: 1 })
        expect((await recipientsOf(ok.body.id)).map((r) => r.userId)).toEqual([mine.id])

        await send(c, coachActor, { segment: 'GROUPS', groupIds: [foreign.id] }).expect(403)
        await send(c, coachActor, { segment: 'UNPAID' }).expect(403)
        await send(c, coachActor, { segment: 'ALL', isService: true }).expect(403)
        // «Все мои ученики» stays in own groups.
        const all = await send(c, coachActor, { segment: 'ALL' }).expect(201)
        expect((await recipientsOf(all.body.id)).map((r) => r.userId)).toEqual([mine.id])
        // A student outside the coach's groups is «not found».
        await send(c, coachActor, { segment: 'MEMBERS', memberIds: [theirs.id] }).expect(404)
        // The coach's history: own messages only.
        const list = await ctx.http().get(`/workspaces/${c.w}/messages`).set(...coachActor.auth).expect(200)
        expect(list.body.total).toBe(2)
    })

    it("a child's message reaches its guardians with the child's name and opening it marks the child's row read", async () => {
        const c = await club()
        const parent = await signIn(ctx, 'parent-messages@example.com')
        await device(parent.userId)
        const child = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...parent.auth)
                .send({ firstname: 'Миша', lastname: 'Петров', dateOfBirth: '2017-05-04', consent: true })
                .expect(201)
        ).body as { id: string }
        await addMember(ctx, { workspaceId: c.w, userId: child.id })
        const kids = await group(c, c.owner.id, [child.id], 'Дети')

        const res = await send(c, c.ownerActor, { segment: 'GROUPS', groupIds: [kids.id], title: 'Форма на соревнования' }).expect(201)
        expect(res.body).toMatchObject({ recipientCount: 1, pushCount: 1 })
        // The recipient row is the child's; the push went to the parent.
        expect(await recipientsOf(res.body.id)).toEqual([
            { userId: child.id, pushSkip: null, readAt: null, emailedAt: null },
        ])
        const pushes = await pushRowsFor(res.body.id)
        expect(pushes.map((p) => [p.userId, p.topic])).toEqual([[parent.userId, 'Миша: Форма на соревнования']])
        expect(pushes[0].metadata).toMatchObject({ dependentId: child.id })

        const actAs: [string, string] = ['X-Act-As', child.id]
        const read = await ctx
            .http()
            .post(`/workspaces/${c.w}/me/messages/${res.body.id}/read`)
            .set(...parent.auth)
            .set(...actAs)
            .expect(200)
        expect(read.body.readAt).toEqual(expect.any(String))
        // Again: idempotent.
        await ctx
            .http()
            .post(`/workspaces/${c.w}/me/messages/${res.body.id}/read`)
            .set(...parent.auth)
            .set(...actAs)
            .expect(200)
        const msg = await ctx.http().get(`/workspaces/${c.w}/messages/${res.body.id}`).set(...c.ownerActor.auth).expect(200)
        expect(msg.body.readCount).toBe(1)
        const recipients = await ctx
            .http()
            .get(`/workspaces/${c.w}/messages/${res.body.id}/recipients`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(recipients.body.data).toEqual([
            expect.objectContaining({
                userId: child.id,
                isDependent: true,
                guardianNames: [expect.any(String)],
                readAt: expect.any(String),
            }),
        ])
        // Without acting as the child the parent has no such message here.
        await ctx.http().post(`/workspaces/${c.w}/me/messages/${res.body.id}/read`).set(...parent.auth).expect(403)
    })

    it('opted-out member gets no push for a broadcast but gets a service and a direct message', async () => {
        const c = await club()
        const s = await student(c, 'Иван', { device: true })
        const actor = await signIn(ctx, s.email as string)
        await ctx
            .http()
            .put('/me/notification-preferences')
            .set(...actor.auth)
            .send({ clubMessagesEnabled: false })
            .expect(200)

        const broadcast = await send(c, c.ownerActor, { segment: 'ALL', title: 'Рассылка' }).expect(201)
        const service = await send(c, c.ownerActor, { segment: 'ALL', title: 'Отмена', isService: true }).expect(201)
        const direct = await send(c, c.ownerActor, { segment: 'MEMBERS', memberIds: [s.id], title: 'Лично' }).expect(201)
        expect(direct.body.isDirect).toBe(true)

        expect(await recipientsOf(broadcast.body.id)).toEqual([expect.objectContaining({ pushSkip: 'opted_out' })])
        expect(await pushRowsFor(broadcast.body.id)).toEqual([])
        for (const [m, kind] of [
            [service, 'message.service'],
            [direct, 'message.direct'],
        ] as const) {
            expect(await recipientsOf(m.body.id)).toEqual([expect.objectContaining({ pushSkip: null })])
            const rows = await pushRowsFor(m.body.id)
            expect(rows.map((r) => r.userId)).toEqual([s.id])
            expect(rows[0].metadata).toMatchObject({ kind })
        }
        // Every message stays in «Сообщения клуба».
        const mine = await ctx.http().get(`/workspaces/${c.w}/me/messages`).set(...actor.auth).expect(200)
        expect(mine.body.data.map((m: { title: string }) => m.title).sort()).toEqual(['Лично', 'Отмена', 'Рассылка'])
    })

    it('message composed at 23:00 club time is held until 09:00 unless urgent', async () => {
        const c = await club(23)
        const { timezone } = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: c.w } })
        const s = await student(c, 'Иван', { device: true })

        const before = Date.now()
        const held = await send(c, c.ownerActor, { segment: 'ALL', title: 'Утром' }).expect(201)
        expect(held.body.status).toBe('SCHEDULED')
        const sendAt = new Date(held.body.sendAt)
        expect(localHourInTz(sendAt, timezone)).toBe(9)
        expect(sendAt.getUTCMinutes()).toBe(0)
        expect(sendAt.getTime()).toBeGreaterThan(before)
        expect(sendAt.getTime() - before).toBeLessThanOrEqual(10 * 3600_000)
        expect(await recipientsOf(held.body.id)).toEqual([])

        const urgent = await send(c, c.ownerActor, { segment: 'ALL', title: 'Срочно', urgent: true }).expect(201)
        expect(urgent.body).toMatchObject({ status: 'SENT', recipientCount: 1 })

        // The minute job: not yet at 08:59, sent at 09:00.
        const reminders = ctx.app.get(RemindersService)
        expect((await reminders.run(new Date(sendAt.getTime() - 60_000))).clubMessagesSent).toBe(0)
        expect((await reminders.run(sendAt)).clubMessagesSent).toBe(1)
        expect(await recipientsOf(held.body.id)).toEqual([expect.objectContaining({ userId: s.id, pushSkip: null })])
        const after = await ctx.prisma.clubMessage.findUniqueOrThrow({ where: { id: held.body.id } })
        expect(after).toMatchObject({ status: 'SENT', sentAt: sendAt, recipientCount: 1 })
    })

    it('daily club limit refuses the 11th broadcast', async () => {
        const c = await club()
        const s = await student(c, 'Иван', { device: true })
        for (let i = 0; i < 10; i += 1) {
            await send(c, c.ownerActor, { segment: 'ALL', title: `Рассылка ${i + 1}`, isService: true }).expect(201)
        }
        const refused = await send(c, c.ownerActor, { segment: 'ALL', title: 'Одиннадцатая' }).expect(400)
        expect(refused.body.message).toContain('Сегодня клуб уже отправил 10 рассылок')
        expect(await ctx.prisma.clubMessage.count({ where: { workspaceId: c.w } })).toBe(10)
        // A direct message has its own limit.
        await send(c, c.ownerActor, { segment: 'MEMBERS', memberIds: [s.id] }).expect(201)
        // Service broadcasts never count toward a recipient's daily push cap.
        expect(await ctx.prisma.clubMessageRecipient.count({ where: { userId: s.id, pushSkip: 'cap' } })).toBe(0)
    })

    it('parallel sends cannot pass the daily limit together', async () => {
        const c = await club()
        await student(c, 'Иван')
        for (let i = 0; i < 8; i += 1) {
            await send(c, c.ownerActor, { segment: 'ALL', title: `Рассылка ${i + 1}`, isService: true }).expect(201)
        }
        const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) => send(c, c.ownerActor, { segment: 'ALL', title: `Одновременно ${i}` })),
        )
        expect(results.map((r) => r.status).sort()).toEqual([201, 201, 400, 400, 400])
        expect(await ctx.prisma.clubMessage.count({ where: { workspaceId: c.w } })).toBe(10)
        // Scheduled for tomorrow: counted against tomorrow, not today.
        const tomorrow = new Date(Date.now() + DAY)
        await send(c, c.ownerActor, { segment: 'ALL', sendAt: tomorrow.toISOString() }).expect(201)
    })

    it('direct message from the call list logs the contact and drops the member from the list', async () => {
        const c = await club()
        const slipping = await student(c, 'Пропал')
        const regular = await student(c, 'Ходит')
        const g = await group(c, c.owner.id, [slipping.id, regular.id])
        const visit = async (userId: string, daysAgo: number) => {
            const at = new Date(Date.now() - daysAgo * DAY)
            const session = await ctx.prisma.attendanceSession.create({
                data: {
                    workspaceId: c.w,
                    groupId: g.id,
                    occurrenceKey: `adhoc:${g.id}:${at.toISOString()}:${userId}`,
                    title: 'Тренировка',
                    startAt: at,
                    timezone: 'Asia/Tomsk',
                    createdById: c.owner.id,
                },
            })
            await ctx.prisma.attendanceRecord.create({
                data: { sessionId: session.id, workspaceId: c.w, userId, markedById: c.owner.id, markedAt: at },
            })
        }
        for (const d of [100, 40, 20]) await visit(slipping.id, d)
        for (const d of [120, 1]) await visit(regular.id, d)

        const callList = () =>
            ctx.http().get(`/workspaces/${c.w}/at-risk-members`).set(...c.ownerActor.auth).expect(200)
        expect((await callList()).body.data.map((m: { userId: string }) => m.userId)).toEqual([slipping.id])

        // Not on the list: refused, nothing written.
        await send(c, c.ownerActor, { segment: 'MEMBERS', memberIds: [regular.id], logContact: true }).expect(400)
        expect(await ctx.prisma.clubMessage.count()).toBe(0)

        // Written for later and then cancelled: the «Связались» is taken back.
        const later = await send(c, c.ownerActor, {
            segment: 'MEMBERS',
            memberIds: [slipping.id],
            logContact: true,
            title: 'Позвоним позже',
            sendAt: new Date(Date.now() + 2 * DAY).toISOString(),
        }).expect(201)
        expect(later.body.status).toBe('SCHEDULED')
        expect(await ctx.prisma.memberRetentionContact.count({ where: { userId: slipping.id } })).toBe(1)
        expect((await callList()).body.data).toEqual([])
        await ctx
            .http()
            .post(`/workspaces/${c.w}/messages/${later.body.id}/cancel`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(await ctx.prisma.memberRetentionContact.count({ where: { userId: slipping.id } })).toBe(0)
        expect((await callList()).body.data.map((m: { userId: string }) => m.userId)).toEqual([slipping.id])

        const res = await send(c, c.ownerActor, {
            segment: 'MEMBERS',
            memberIds: [slipping.id],
            logContact: true,
            title: 'Ждём вас',
        }).expect(201)
        expect(res.body).toMatchObject({ isDirect: true, status: 'SENT', recipientCount: 1 })
        const contact = await ctx.prisma.memberRetentionContact.findFirstOrThrow({ where: { userId: slipping.id } })
        expect(contact).toMatchObject({ contactedById: c.owner.id, note: 'Сообщение: Ждём вас', reason: 'absent' })
        expect((await ctx.prisma.clubMessage.findUniqueOrThrow({ where: { id: res.body.id } })).contactId).toBe(contact.id)
        // Gone from the list at once (the cache was dropped).
        expect((await callList()).body.data).toEqual([])
    })

    it('e-mail copy honours the club switch and the member unsubscribe link', async () => {
        const c = await club()
        const s = await student(c, 'Иван')

        await send(c, c.ownerActor, { segment: 'ALL', withEmail: true }).expect(400)
        await ctx
            .http()
            .patch(`/workspaces/${c.w}/settings`)
            .set(...c.ownerActor.auth)
            .send({ messagesEmailEnabled: true })
            .expect(200)

        const first = await send(c, c.ownerActor, { segment: 'ALL', withEmail: true, title: 'Письмо' }).expect(201)
        const mail = await ctx.mail.waitFor((m) => m.to === s.email && m.subject.startsWith('Письмо'))
        expect(mail.subject).toBe('Письмо — Академия')
        expect(mail.html).toContain('Тренировка в субботу')
        const header = mail.headers?.['List-Unsubscribe'] ?? ''
        expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
        const url = new URL(header.replace(/^<|>$/g, ''))
        expect(url.pathname).toBe('/public/unsubscribe/club-messages')
        expect(mail.html).toContain(url.search.slice(1))
        expect((await recipientsOf(first.body.id))[0].emailedAt).toEqual(expect.any(Date))
        expect((await ctx.prisma.clubMessage.findUniqueOrThrow({ where: { id: first.body.id } })).emailCount).toBe(1)

        // Opening the link (what a mail scanner does too) only asks to confirm.
        const confirm = await ctx.http().get(`${url.pathname}${url.search}`).expect(200)
        expect(confirm.text).toContain('Отписаться от писем клуба?')
        expect(confirm.text).toContain('<form method="post"')
        expect(
            (await ctx.prisma.notificationPreferences.findUnique({ where: { userId: s.id } }))?.clubMessagesEmailEnabled ??
                true,
        ).toBe(true)
        await ctx.http().get(`${url.pathname}?token=${s.id}.forgedforgedforgedforg`).expect(400)
        await ctx.http().post(`${url.pathname}?token=${s.id}.forgedforgedforgedforg`).expect(400)
        // The button / the mail client's one-click POST writes.
        const done = await ctx
            .http()
            .post(`${url.pathname}${url.search}`)
            .type('form')
            .send('List-Unsubscribe=One-Click')
            .expect(200)
        expect(done.text).toContain('Вы отписались от писем клуба')
        const prefs = await ctx.prisma.notificationPreferences.findUniqueOrThrow({ where: { userId: s.id } })
        expect(prefs.clubMessagesEmailEnabled).toBe(false)

        ctx.mail.clear()
        const second = await send(c, c.ownerActor, { segment: 'ALL', withEmail: true, title: 'Второе' }).expect(201)
        // The in-app copy still arrives; no e-mail.
        expect(await recipientsOf(second.body.id)).toEqual([expect.objectContaining({ emailedAt: null })])
        await new Promise((r) => setTimeout(r, 300))
        expect(ctx.mail.sent.filter((m) => m.to === s.email)).toEqual([])
    })

    it('cancelling a scheduled message prevents delivery', async () => {
        const c = await club()
        await student(c, 'Иван')
        const at = new Date(Date.now() + 2 * DAY)
        const scheduled = await send(c, c.ownerActor, { segment: 'ALL', sendAt: at.toISOString() }).expect(201)
        expect(scheduled.body.status).toBe('SCHEDULED')

        const cancelled = await ctx
            .http()
            .post(`/workspaces/${c.w}/messages/${scheduled.body.id}/cancel`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(cancelled.body.status).toBe('CANCELLED')
        await ctx
            .http()
            .post(`/workspaces/${c.w}/messages/${scheduled.body.id}/cancel`)
            .set(...c.ownerActor.auth)
            .expect(400)

        const sendAt = new Date(scheduled.body.sendAt)
        expect((await ctx.app.get(RemindersService).run(new Date(sendAt.getTime() + 60_000))).clubMessagesSent).toBe(0)
        expect(await recipientsOf(scheduled.body.id)).toEqual([])
        expect(await ctx.prisma.auditEvent.count({ where: { action: 'message.cancel', targetId: scheduled.body.id } })).toBe(1)
    })
})
