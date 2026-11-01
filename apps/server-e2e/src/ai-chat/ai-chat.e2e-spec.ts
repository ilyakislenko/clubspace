import { randomUUID } from 'crypto'

import { AI_CHAT_DATA_WARNING } from '../../../server/src/domains/ai-assistant/ai-chat-warning'
import { pseudonymFor } from '../../../server/src/domains/ai-assistant/pseudonym'
import { environment } from '../../../server/src/environments/environment'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { startFakeLlm, toolThenAnswer, type FakeLlm } from '../support/fake-llm'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

type StreamEvent = { event: string; data: Record<string, unknown> }

const parseSse = (raw: string): StreamEvent[] =>
    raw
        .split('\n\n')
        .filter((block) => block.trim().length > 0)
        .map((block) => {
            const event = /^event: (.+)$/m.exec(block)?.[1] ?? ''
            const data = /^data: (.+)$/m.exec(block)?.[1] ?? '{}'
            return { event, data: JSON.parse(data) as Record<string, unknown> }
        })

// «ИИ-ассистент» chat in the admin, against a local fake OpenAI-compatible
// model (support/fake-llm.ts): a question streams back with tool progress and
// chips; the tools run in the asker's scope; the model never receives a name,
// phone or e-mail (asserted on the requests it got); the owner's consent gates
// the chat, a club has a monthly limit, every question is audited.
describe('ИИ-ассистент: чат в админке', () => {
    let ctx: TestApp
    let llm: FakeLlm
    const saved = { ...environment.ai.chat }

    beforeAll(async () => {
        ctx = await createTestApp()
        llm = await startFakeLlm(toolThenAnswer(() => ({ name: 'search_members', arguments: { limit: 50 } })))
    })
    afterAll(async () => {
        await llm?.close()
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        Object.assign(environment.ai.chat, saved, { baseUrl: llm.url, apiKey: 'test-key' })
        llm.requests.length = 0
        llm.script = toolThenAnswer(() => ({ name: 'search_members', arguments: { limit: 50 } }))
    })
    afterEach(() => {
        Object.assign(environment.ai.chat, saved)
    })

    const http = () => ctx.http()

    const PEOPLE = {
        owner: { firstname: 'Олег', lastname: 'Владельцев', phone: '+79005550001' },
        ivan: { firstname: 'Иван', lastname: 'Петров', phone: '+79001112233' },
        maria: { firstname: 'Мария', lastname: 'Сидорова', phone: '+79004445566' },
        manager: { firstname: 'Глеб', lastname: 'Руководов', phone: '+79007778899' },
        coach: { firstname: 'Пётр', lastname: 'Тренеров', phone: '+79003334455' },
    }

    // Club: БЖЖ and ММА, a group of each; Иван trains БЖЖ, Мария ММА; Глеб
    // runs БЖЖ (руководитель направления); Пётр is a plain coach.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Клуб А' })
        const w = workspace.id
        await ctx.prisma.user.update({ where: { id: owner.id }, data: PEOPLE.owner })
        const ownerActor = await signIn(ctx, owner.email!)
        const direction = async (name: string) =>
            (
                await http()
                    .post(`/workspaces/${w}/directions`)
                    .set(...ownerActor.auth)
                    .send({ name })
                    .expect(201)
            ).body.id as string
        const bjj = await direction('БЖЖ')
        const mma = await direction('ММА')
        const group = (name: string, directionId: string) =>
            ctx.prisma.group.create({
                data: { workspaceId: w, name, coachId: owner.id, directionId },
            })
        const bjjGroup = await group('БЖЖ взрослые', bjj)
        const mmaGroup = await group('ММА вечер', mma)
        const student = async (person: (typeof PEOPLE)['ivan'], email: string, groupId: string) => {
            const { user } = await addMember(ctx, { workspaceId: w })
            await ctx.prisma.user.update({ where: { id: user.id }, data: { ...person, email } })
            await ctx.prisma.groupMember.create({ data: { groupId, userId: user.id } })
            return { ...user, email }
        }
        const ivan = await student(PEOPLE.ivan, 'ivan.petrov@example.com', bjjGroup.id)
        const maria = await student(PEOPLE.maria, 'maria.sidorova@example.com', mmaGroup.id)

        const { user: managerUser } = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        await ctx.prisma.user.update({ where: { id: managerUser.id }, data: PEOPLE.manager })
        const manager = await signIn(ctx, managerUser.email!)
        await http()
            .post(`/workspaces/${w}/direction-managers`)
            .set(...ownerActor.auth)
            .send({ directionId: bjj, userId: managerUser.id })
            .expect(201)
        const { user: coachUser } = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        await ctx.prisma.user.update({ where: { id: coachUser.id }, data: PEOPLE.coach })
        const coach = await signIn(ctx, coachUser.email!)
        const { user: studentUser } = await addMember(ctx, { workspaceId: w })
        const studentActor = await signIn(ctx, studentUser.email!)

        const ref = (userId: string) => pseudonymFor(environment.encryptionKey, w, userId, 'member')
        return {
            w,
            owner,
            ownerActor,
            managerUser,
            manager,
            coach,
            coachUser,
            studentActor,
            bjjGroup,
            mmaGroup,
            ivan,
            maria,
            ref,
        }
    }

    type Setup = Awaited<ReturnType<typeof setup>>

    const personalStrings = (c: Setup) => [
        ...Object.values(PEOPLE).flatMap((p) => [p.firstname, p.lastname, p.phone]),
        c.ivan.email,
        c.maria.email,
        c.owner.email!,
        c.managerUser.email!,
        c.coachUser.email!,
    ]

    const enable = (c: Setup) =>
        http()
            .post(`/workspaces/${c.w}/ai-chat/consent`)
            .set(...c.ownerActor.auth)
            .send({ warningVersion: AI_CHAT_DATA_WARNING.version })
            .expect(201)

    const ask = (actor: Actor, w: string, question: string, conversationId: string = randomUUID()) =>
        http()
            .post(`/workspaces/${w}/ai-chat/conversations/${conversationId}/messages`)
            .set(...actor.auth)
            .send({ question })
            .buffer(true)
            .parse((res, done) => {
                let data = ''
                res.setEncoding('utf8')
                res.on('data', (chunk: string) => (data += chunk))
                res.on('end', () => done(null, data))
            })

    const streamOf = async (actor: Actor, w: string, question: string, conversationId?: string) => {
        const res = await ask(actor, w, question, conversationId)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
        return parseSse(res.body as string)
    }

    it('answers a question: tool progress, streamed text, chips with names — none of it sent to the model', async () => {
        const c = await setup()
        await enable(c)
        const conversationId = randomUUID()

        const events = await streamOf(
            c.ownerActor,
            c.w,
            'Как дела у Иван Петров? Его телефон +7 900 111-22-33, почта ivan.petrov@example.com',
            conversationId,
        )
        expect(events[0]).toMatchObject({ event: 'start', data: { conversationId } })
        expect(events.filter((e) => e.event === 'tool').map((e) => e.data)).toEqual([
            expect.objectContaining({ tool: 'search_members', label: 'Ищу участников…', status: 'running' }),
            expect.objectContaining({ tool: 'search_members', status: 'done' }),
        ])
        const text = events
            .filter((e) => e.event === 'text')
            .map((e) => e.data.text)
            .join('')
        expect(text).toContain(c.ref(c.ivan.id))
        expect(text).toContain(`[group:${c.bjjGroup.id}]`)
        const entities = events
            .filter((e) => e.event === 'entities')
            .flatMap((e) => e.data.entities as Record<string, unknown>[])
        expect(entities).toEqual(
            expect.arrayContaining([
                { token: c.ref(c.ivan.id), type: 'member', id: c.ivan.id, label: 'Иван Петров' },
                { token: c.ref(c.maria.id), type: 'member', id: c.maria.id, label: 'Мария Сидорова' },
                { token: `[group:${c.bjjGroup.id}]`, type: 'group', id: c.bjjGroup.id, label: 'БЖЖ взрослые' },
            ]),
        )
        expect(events[events.length - 1]).toMatchObject({
            event: 'done',
            data: { usage: { inputTokens: 2400, outputTokens: 160 }, limit: { used: 1 } },
        })

        // What the model received: two rounds, the club's key, the tools, and
        // not one name, phone or e-mail — the question was pseudonymized too.
        expect(llm.requests).toHaveLength(2)
        expect(llm.requests[0].authorization).toBe('Bearer test-key')
        expect(llm.requests[0].body).toMatchObject({ model: saved.model, stream: true })
        const sent = JSON.stringify(llm.requests.map((r) => r.body))
        for (const pii of personalStrings(c)) expect(sent).not.toContain(pii)
        expect(sent).not.toContain('900 111-22-33')
        const question = llm.requests[0].body.messages.find((m) => m.role === 'user')!.content!
        expect(question).toContain(c.ref(c.ivan.id))
        expect(question).toContain('[телефон скрыт]')
        expect(question).toContain('[e-mail скрыт]')
        expect(sent).toContain(c.ref(c.maria.id))

        // Saved: the list, the conversation with its turn and chips, the
        // usage row with the provider's tokens, the audit line.
        const list = await http()
            .get(`/workspaces/${c.w}/ai-chat/conversations`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(list.body.data).toEqual([
            expect.objectContaining({ id: conversationId, questions: 1, title: expect.stringContaining('Как дела у Иван Петров') }),
        ])
        const saved_ = await http()
            .get(`/workspaces/${c.w}/ai-chat/conversations/${conversationId}`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(saved_.body.turns).toEqual([
            expect.objectContaining({
                question: expect.stringContaining('+7 900 111-22-33'),
                steps: [{ tool: 'search_members', label: 'Ищу участников…', isError: false }],
                answer: expect.stringContaining(c.ref(c.ivan.id)),
                error: null,
            }),
        ])
        expect(saved_.body.entities).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'member', id: c.ivan.id, label: 'Иван Петров' }),
            ]),
        )
        const usage = await ctx.prisma.aiChatUsage.findMany({ where: { workspaceId: c.w } })
        expect(usage).toEqual([
            expect.objectContaining({
                conversationId,
                inputTokens: 2400,
                outputTokens: 160,
                toolCalls: 1,
                status: 'ok',
            }),
        ])
        const audit = await ctx.prisma.auditEvent.findMany({
            where: { workspaceId: c.w, action: 'ai.chatQuestion' },
        })
        expect(audit).toHaveLength(1)
        expect(audit[0]).toMatchObject({ actorId: c.owner.id, targetType: 'aiChat', targetId: conversationId })
        expect(audit[0].metadata).toMatchObject({ tools: ['search_members'], status: 'ok', inputTokens: 2400 })
        expect(JSON.stringify(audit[0].metadata)).not.toContain('Петров')

        // A follow-up replays the conversation — still without names.
        await streamOf(c.ownerActor, c.w, 'А кто из них ходит реже?', conversationId)
        const followUp = JSON.stringify(llm.requests.slice(2).map((r) => r.body))
        expect(followUp).toContain(c.ref(c.ivan.id))
        for (const pii of personalStrings(c)) expect(followUp).not.toContain(pii)
    })

    it('a руководитель направления: own directions only, no money tools; coaches and students are refused', async () => {
        const c = await setup()
        await enable(c)
        await streamOf(c.manager, c.w, 'Кто у меня занимается?')

        const first = llm.requests[0].body
        const tools = (first.tools ?? []).map((t) => t.function.name)
        expect(tools).toContain('search_members')
        expect(tools).toContain('schedule_occupancy')
        expect(tools).not.toContain('revenue_report')
        expect(tools).not.toContain('unpaid_abonements')
        expect(first.messages[0].content).toContain('только направления')
        const toolResult = llm.requests[1].body.messages.find((m) => m.role === 'tool')!.content!
        expect(toolResult).toContain(c.ref(c.ivan.id))
        expect(toolResult).not.toContain(c.ref(c.maria.id))

        // The model insisting on a money tool gets a refusal it can read.
        llm.script = toolThenAnswer(() => ({ name: 'revenue_report', arguments: {} }))
        const events = await streamOf(c.manager, c.w, 'Какая выручка?')
        expect(events.find((e) => e.event === 'tool' && e.data.status !== 'running')?.data).toMatchObject({
            tool: 'revenue_report',
            status: 'error',
        })

        // Owner's conversations are the owner's.
        const ownerConversation = randomUUID()
        await streamOf(c.ownerActor, c.w, 'Кто занимается?', ownerConversation)
        await http()
            .get(`/workspaces/${c.w}/ai-chat/conversations/${ownerConversation}`)
            .set(...c.manager.auth)
            .expect(404)
        expect((await ask(c.manager, c.w, 'Чужой диалог', ownerConversation)).status).toBe(404)
        await http()
            .delete(`/workspaces/${c.w}/ai-chat/conversations/${ownerConversation}`)
            .set(...c.manager.auth)
            .expect(404)

        // A plain coach and a student never reach the chat.
        await http().get(`/workspaces/${c.w}/ai-chat`).set(...c.coach.auth).expect(403)
        expect((await ask(c.coach, c.w, 'Кто занимается?')).status).toBe(403)
        await http().get(`/workspaces/${c.w}/ai-chat`).set(...c.studentActor.auth).expect(403)
    })

    it('needs the owner to accept the transfer of data first', async () => {
        const c = await setup()
        const before = await http().get(`/workspaces/${c.w}/ai-chat`).set(...c.manager.auth).expect(200)
        expect(before.body).toMatchObject({
            configured: true,
            scope: 'directions',
            consent: { accepted: false, canAccept: false, warning: { version: AI_CHAT_DATA_WARNING.version } },
        })
        const refused = await ask(c.manager, c.w, 'Кто занимается?')
        expect(refused.status).toBe(403)
        expect(llm.requests).toHaveLength(0)

        // Only the owner, and only the edition on screen.
        await http()
            .post(`/workspaces/${c.w}/ai-chat/consent`)
            .set(...c.manager.auth)
            .send({ warningVersion: AI_CHAT_DATA_WARNING.version })
            .expect(403)
        await http()
            .post(`/workspaces/${c.w}/ai-chat/consent`)
            .set(...c.ownerActor.auth)
            .send({ warningVersion: 'chat-2020-01-01' })
            .expect(409)
        const accepted = await enable(c)
        expect(accepted.body.consent).toMatchObject({ accepted: true, canAccept: true })
        const evidence = await ctx.prisma.aiDataTransferAcceptance.findMany({ where: { workspaceId: c.w } })
        expect(evidence).toEqual([
            expect.objectContaining({ userId: c.owner.id, warningVersion: AI_CHAT_DATA_WARNING.version, tokenId: null }),
        ])
        expect(
            await ctx.prisma.auditEvent.count({ where: { workspaceId: c.w, action: 'ai.chatEnable' } }),
        ).toBe(1)

        await streamOf(c.manager, c.w, 'Кто занимается?')
        expect(llm.requests.length).toBeGreaterThan(0)
    })

    it('without AI_CHAT_API_KEY says «не настроено» and sends nothing', async () => {
        const c = await setup()
        await enable(c)
        environment.ai.chat.apiKey = undefined
        const state = await http().get(`/workspaces/${c.w}/ai-chat`).set(...c.ownerActor.auth).expect(200)
        expect(state.body).toMatchObject({ configured: false, model: null })
        const res = await ask(c.ownerActor, c.w, 'Кому позвонить сегодня?')
        expect(res.status).toBe(400)
        expect(JSON.parse(res.body as string).message).toContain('не настроен')
        expect(llm.requests).toHaveLength(0)
    })

    it('counts questions per club per month and refuses past the limit; a provider error is shown and counted', async () => {
        const c = await setup()
        await enable(c)
        // A new club is on its trial: the trial allowance applies.
        environment.ai.chat.trialMonthlyQuestions = 2

        llm.script = () => ({ status: 401, error: 'Invalid API key' })
        const failed = await streamOf(c.ownerActor, c.w, 'Кому позвонить сегодня?')
        expect(failed.find((e) => e.event === 'error')?.data.message).toContain('ИИ-сервис ответил ошибкой 401')

        llm.script = () => ({ text: 'Всё спокойно.' })
        await streamOf(c.manager, c.w, 'Как дела?')
        const state = await http().get(`/workspaces/${c.w}/ai-chat`).set(...c.ownerActor.auth).expect(200)
        expect(state.body.limit).toEqual({ perMonth: 2, used: 2, remaining: 0 })

        const over = await ask(c.ownerActor, c.w, 'Ещё вопрос')
        expect(over.status).toBe(429)
        expect(JSON.parse(over.body as string).message).toContain('Лимит ИИ-ассистента')
        expect(llm.requests).toHaveLength(2)
        const statuses = (await ctx.prisma.aiChatUsage.findMany({ where: { workspaceId: c.w } })).map(
            (u) => u.status,
        )
        expect(statuses.sort()).toEqual(['error', 'ok'])

        // Deleting conversations doesn't give questions back.
        const list = await http().get(`/workspaces/${c.w}/ai-chat/conversations`).set(...c.ownerActor.auth)
        for (const conv of list.body.data as { id: string }[]) {
            await http()
                .delete(`/workspaces/${c.w}/ai-chat/conversations/${conv.id}`)
                .set(...c.ownerActor.auth)
                .expect(200)
        }
        expect((await ask(c.ownerActor, c.w, 'Ещё вопрос')).status).toBe(429)
    })
})
