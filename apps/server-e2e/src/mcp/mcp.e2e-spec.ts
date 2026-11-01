import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { AI_PERSONAL_DATA_WARNING } from '../../../server/src/domains/ai-assistant/personal-data-warning'
import { signIn, type Actor } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// A tool answer as the spec reads it; deeper fields go through toMatchObject.
type AnswerItem = { member: { ref: string } & Record<string, unknown>; [key: string]: unknown }
type ToolAnswer = {
    isError: boolean
    content: { type: string; text: string }[]
    structuredContent?: { items?: AnswerItem[]; [key: string]: unknown }
}

// ИИ-ассистент over MCP (docs/mcp.md): a club token created in the admin reads
// the club through POST /mcp. The JSON-RPC lifecycle, then the guarantees:
// one club per token, the creator's direction scope, «обезличено» means no
// names/phones/e-mails in any answer, revoked/expired tokens are refused,
// every tool call is audited and each token is rate-limited.
describe('MCP server (ИИ-ассистент)', () => {
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

    const http = () => ctx.http()

    let rpcId = 0
    const rpc = (secret: string, method: string, params?: Record<string, unknown>) =>
        http()
            .post('/mcp')
            .set('Authorization', `Bearer ${secret}`)
            .set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) })

    const call = async (secret: string, name: string, args: Record<string, unknown> = {}) => {
        const res = await rpc(secret, 'tools/call', { name, arguments: args }).expect(200)
        return res.body.result as ToolAnswer
    }

    const createToken = (
        actor: Actor,
        workspaceId: string,
        body: Record<string, unknown> = {},
    ) =>
        http()
            .post(`/workspaces/${workspaceId}/ai-tokens`)
            .set(...actor.auth)
            .send({
                name: 'Claude Desktop',
                dataMode: 'PSEUDONYMIZED',
                expiresInDays: 90,
                scopes: ['read'],
                ...body,
            })

    const PEOPLE = {
        owner: { firstname: 'Олег', lastname: 'Владельцев', phone: '+79005550001' },
        ivan: { firstname: 'Иван', lastname: 'Петров', phone: '+79001112233' },
        maria: { firstname: 'Мария', lastname: 'Сидорова', phone: '+79004445566' },
        manager: { firstname: 'Глеб', lastname: 'Руководов', phone: '+79007778899' },
        boris: { firstname: 'Борис', lastname: 'Чужаков', phone: '+79009990011' },
    }

    // Club A: БЖЖ and ММА, a group of each, Иван trains БЖЖ, Мария ММА; a
    // coach runs БЖЖ. Club B: Борис. Abonements (one unpaid), visits, a ladder
    // with a grading, events, a weekly slot per group.
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
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: w, name: 'Манеж', address: 'ул. Тестовая, 1', timezone: 'Europe/Moscow' },
        })
        const group = (name: string, directionId: string) =>
            ctx.prisma.group.create({
                data: {
                    workspaceId: w,
                    name,
                    gymId: gym.id,
                    coachId: owner.id,
                    directionId,
                    coaches: { create: { userId: owner.id, role: 'primary' } },
                    slots: {
                        create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
                            dayOfWeek,
                            startTime: '19:00',
                            durationMin: 90,
                        })),
                    },
                },
            })
        const bjjGroup = await group('БЖЖ взрослые', bjj)
        const mmaGroup = await group('ММА вечер', mma)

        const student = async (person: (typeof PEOPLE)['ivan'], email: string, groupId: string) => {
            const { member, user } = await addMember(ctx, { workspaceId: w })
            await ctx.prisma.user.update({ where: { id: user.id }, data: { ...person, email } })
            await ctx.prisma.groupMember.create({ data: { groupId, userId: user.id } })
            return { member, user: { ...user, email } }
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
        const coach = await signIn(ctx, coachUser.email!)

        const plan = await ctx.prisma.plan.create({
            data: {
                workspaceId: w,
                name: 'БЖЖ 8 занятий',
                price: 4000,
                currency: 'RUB',
                classCount: 8,
                directions: { create: { directionId: bjj } },
            },
        })
        const now = Date.now()
        await ctx.prisma.subscription.create({
            data: {
                workspaceId: w,
                planId: plan.id,
                workspaceMemberId: ivan.member.id,
                startDate: new Date(now - 10 * DAY),
                endDate: new Date(now + 20 * DAY),
                amountPaid: 4000,
                currency: 'RUB',
                isPaid: true,
                paidAt: new Date(now - 10 * DAY),
                classesTotal: 8,
                classesRemaining: 1,
                directions: { create: { directionId: bjj } },
            },
        })
        await ctx.prisma.subscription.create({
            data: {
                workspaceId: w,
                planId: plan.id,
                workspaceMemberId: maria.member.id,
                startDate: new Date(now - 2 * DAY),
                endDate: new Date(now + 28 * DAY),
                amountPaid: 4000,
                currency: 'RUB',
                isPaid: false,
                classesTotal: 8,
                classesRemaining: 8,
            },
        })

        const visit = async (groupId: string, userId: string, daysAgo: number) => {
            const at = new Date(now - daysAgo * DAY)
            const session = await ctx.prisma.attendanceSession.create({
                data: {
                    workspaceId: w,
                    groupId,
                    occurrenceKey: `adhoc:${groupId}:${at.toISOString()}`,
                    title: 'Тренировка',
                    startAt: at,
                    timezone: 'Europe/Moscow',
                    createdById: owner.id,
                    coachId: owner.id,
                },
            })
            await ctx.prisma.attendanceRecord.create({
                data: { sessionId: session.id, workspaceId: w, userId, markedById: owner.id, markedAt: at },
            })
        }
        await visit(bjjGroup.id, ivan.user.id, 1)
        await visit(bjjGroup.id, ivan.user.id, 3)
        await visit(mmaGroup.id, maria.user.id, 2)

        const ladder = await ctx.prisma.rankLadder.create({
            data: {
                workspaceId: w,
                name: 'Пояса БЖЖ',
                directionId: bjj,
                levels: { create: [{ name: 'Белый', order: 0 }, { name: 'Синий', order: 1 }] },
            },
            include: { levels: { orderBy: { order: 'asc' } } },
        })
        await ctx.prisma.rankPromotion.create({
            data: {
                workspaceId: w,
                userId: ivan.user.id,
                ladderId: ladder.id,
                levelId: ladder.levels[0].id,
                awardedById: owner.id,
                stripes: 2,
            },
        })
        const gradingDate = new Date(now + 10 * DAY).toISOString().slice(0, 10)
        await ctx.prisma.rankGrading.create({
            data: {
                workspaceId: w,
                ladderId: ladder.id,
                date: new Date(`${gradingDate}T00:00:00Z`),
                title: 'Аттестация на синий',
                createdById: owner.id,
                candidates: {
                    create: {
                        workspaceId: w,
                        userId: ivan.user.id,
                        levelId: ladder.levels[1].id,
                        fromLevelName: 'Белый',
                        fromStripes: 2,
                    },
                },
            },
        })
        const event = (title: string, directionId: string) =>
            ctx.prisma.workspaceEvent.create({
                data: {
                    workspaceId: w,
                    title,
                    startAt: new Date(now + 3 * DAY),
                    endAt: new Date(now + 3 * DAY + 2 * 3600_000),
                    timezone: 'Europe/Moscow',
                    directionId,
                    createdById: owner.id,
                    coachId: owner.id,
                },
            })
        await event('Семинар по БЖЖ', bjj)
        await event('Спарринги ММА', mma)

        // Club B with one student.
        const b = await createWorkspace(ctx, { name: 'Клуб Б' })
        const { user: boris } = await addMember(ctx, { workspaceId: b.workspace.id })
        await ctx.prisma.user.update({
            where: { id: boris.id },
            data: { ...PEOPLE.boris, email: 'boris.chuzhakov@example.com' },
        })
        const ownerB = await signIn(ctx, b.owner.email!)

        return {
            w,
            owner,
            ownerActor,
            bjj,
            mma,
            gym,
            bjjGroup,
            mmaGroup,
            ivan,
            maria,
            manager,
            managerUser,
            coach,
            ladder,
            b: { w: b.workspace.id, owner: ownerB, boris },
        }
    }

    // Every name, phone and e-mail of real people in both clubs.
    const personalStrings = (c: Awaited<ReturnType<typeof setup>>) => [
        ...Object.values(PEOPLE).flatMap((p) => [p.firstname, p.lastname, p.phone]),
        c.ivan.user.email,
        c.maria.user.email,
        c.owner.email!,
        c.managerUser.email!,
        'boris.chuzhakov@example.com',
    ]

    it('speaks MCP: initialize, initialized, ping, tools/list, tools/call', async () => {
        const c = await setup()
        const created = await createToken(c.ownerActor, c.w).expect(201)
        const secret = created.body.secret as string
        expect(secret).toMatch(/^csai_/)
        expect(created.body.token).toMatchObject({ state: 'active', dataMode: 'PSEUDONYMIZED', scopes: ['read'] })

        const init = await rpc(secret, 'initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'e2e', version: '1' },
        }).expect(200)
        expect(init.body).toMatchObject({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'clubspace' },
            },
        })
        expect(init.body.result.instructions).toContain('Клуб А')

        await http()
            .post('/mcp')
            .set('Authorization', `Bearer ${secret}`)
            .send({ jsonrpc: '2.0', method: 'notifications/initialized' })
            .expect(202)
        expect((await rpc(secret, 'ping').expect(200)).body.result).toEqual({})

        const list = await rpc(secret, 'tools/list').expect(200)
        const tools = list.body.result.tools as { name: string; inputSchema: { type: string } }[]
        expect(tools.map((t) => t.name)).toEqual(
            expect.arrayContaining(['club_overview', 'revenue_report', 'search_members', 'schedule']),
        )
        for (const t of tools) expect(t.inputSchema.type).toBe('object')

        const overview = await call(secret, 'club_overview')
        expect(overview.isError).toBe(false)
        expect(overview.structuredContent).toMatchObject({
            members: { total: 2, active: 2 },
            attendance: { checkins30d: 3 },
            abonements: { current: 2 },
            money: { revenue30d: 4000, unpaid: { count: 1, amount: 4000 } },
        })
        expect(JSON.parse(overview.content[0].text)).toEqual(overview.structuredContent)

        const revenue = await call(secret, 'revenue_report', { groupBy: 'direction' })
        expect(revenue.structuredContent).toMatchObject({ total: 4000, items: [{ label: 'БЖЖ', revenue: 4000 }] })

        // Protocol errors stay JSON-RPC errors.
        const unknown = await rpc(secret, 'tools/call', { name: 'drop_database' }).expect(200)
        expect(unknown.body.error.code).toBe(-32602)
        expect((await rpc(secret, 'resources/read').expect(200)).body.error.code).toBe(-32601)
        await http()
            .post('/mcp')
            .set('Authorization', `Bearer ${secret}`)
            .send([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
            .expect(400)
        await http().get('/mcp').expect(405)

        // Bad arguments are a tool error the model can read.
        const bad = await call(secret, 'schedule', { from: 'вчера' })
        expect(bad.isError).toBe(true)

        const token = await ctx.prisma.aiAccessToken.findUniqueOrThrow({ where: { id: created.body.token.id } })
        expect(token.lastUsedAt).not.toBeNull()
        expect(token.tokenHash).not.toContain(secret)
    })

    it('«обезличено»: no tool answer carries a name, phone or e-mail', async () => {
        const c = await setup()
        const secret = (await createToken(c.ownerActor, c.w).expect(201)).body.secret as string

        const search = await call(secret, 'search_members', { status: 'all' })
        const refs = search.structuredContent!.items!.map((i) => i.member)
        expect(refs).toHaveLength(2)
        for (const m of refs) expect(Object.keys(m)).toEqual(['ref'])
        const ivanRef = (
            await call(secret, 'search_members', { groupId: c.bjjGroup.id })
        ).structuredContent!.items![0].member.ref
        expect(ivanRef).toMatch(/^m_[0-9a-f]{10}$/)

        const level = await ctx.prisma.rankLevel.findFirstOrThrow({ where: { ladderId: c.ladder.id, order: 0 } })
        const answers = await Promise.all([
            call(secret, 'club_overview'),
            call(secret, 'club_directory'),
            call(secret, 'search_members', { status: 'all' }),
            call(secret, 'member_profile', { member: ivanRef }),
            call(secret, 'at_risk_members', { includeSnoozed: true }),
            call(secret, 'renewals_due'),
            call(secret, 'unpaid_abonements'),
            call(secret, 'abonement_states'),
            call(secret, 'schedule'),
            call(secret, 'attendance_stats'),
            call(secret, 'rank_distribution', { levelId: level.id }),
            call(secret, 'upcoming_gradings'),
            call(secret, 'list_events'),
            call(secret, 'revenue_report', { groupBy: 'tariff' }),
        ])
        for (const a of answers) expect(a.isError).toBe(false)
        const payload = JSON.stringify(answers)
        for (const s of personalStrings(c)) expect(payload).not.toContain(s)

        // The data is there, just pseudonymous.
        const profile = answers[3].structuredContent!
        expect(profile).toMatchObject({
            member: { ref: ivanRef },
            attendance: { visits30d: 2 },
            ranks: [{ ladder: 'Пояса БЖЖ', level: 'Белый', stripes: 2 }],
            upcomingGradings: [{ target: 'Синий' }],
        })
        expect(answers[5].structuredContent!.items).toEqual([
            expect.objectContaining({ member: { ref: ivanRef }, reason: 'low_classes' }),
        ])
        expect(answers[6].structuredContent!.summary).toMatchObject({ count: 1, amount: 4000 })
        expect(answers[11].structuredContent).toMatchObject({
            items: [{ candidates: { list: [{ member: { ref: ivanRef } }] } }],
        })

        // Searching by name would re-identify people: refused.
        const byName = await call(secret, 'search_members', { query: 'Петров' })
        expect(byName.isError).toBe(true)
        expect(JSON.stringify(byName)).not.toContain('Иван')
        const byRef = await call(secret, 'search_members', { query: ivanRef })
        expect(byRef.structuredContent!.total).toBe(1)
    })

    it('«с персональными данными»: owner only, after accepting the warning, recorded', async () => {
        const c = await setup()
        await createToken(c.ownerActor, c.w, { dataMode: 'PERSONAL' }).expect(400)
        await createToken(c.ownerActor, c.w, {
            dataMode: 'PERSONAL',
            personalDataWarningVersion: 'old-edition',
        }).expect(409)
        // An admin who isn't the owner can't hand personal data out.
        const { user: admin } = await addMember(ctx, { workspaceId: c.w, role: RolesEnum.ADMIN })
        const adminActor = await signIn(ctx, admin.email!)
        await createToken(adminActor, c.w, {
            dataMode: 'PERSONAL',
            personalDataWarningVersion: AI_PERSONAL_DATA_WARNING.version,
        }).expect(403)

        const created = await createToken(c.ownerActor, c.w, {
            dataMode: 'PERSONAL',
            personalDataWarningVersion: AI_PERSONAL_DATA_WARNING.version,
        }).expect(201)
        const acceptance = await ctx.prisma.aiDataTransferAcceptance.findFirstOrThrow({
            where: { workspaceId: c.w },
        })
        expect(acceptance).toMatchObject({
            userId: c.owner.id,
            warningVersion: AI_PERSONAL_DATA_WARNING.version,
            tokenId: created.body.token.id,
        })
        const found = await call(created.body.secret, 'search_members', { query: 'Петров' })
        expect(found.structuredContent!.items).toEqual([
            expect.objectContaining({
                member: expect.objectContaining({
                    name: 'Иван Петров',
                    phone: PEOPLE.ivan.phone,
                    email: 'ivan.petrov@example.com',
                }),
            }),
        ])
    })

    it('a token reads only its own club', async () => {
        const c = await setup()
        const secretA = (await createToken(c.ownerActor, c.w).expect(201)).body.secret as string
        const createdB = await createToken(c.b.owner, c.b.w).expect(201)
        const secretB = createdB.body.secret as string

        const borisRef = (await call(secretB, 'search_members')).structuredContent!.items![0].member.ref
        const foreign = await call(secretA, 'member_profile', { member: borisRef })
        expect(foreign.isError).toBe(true)
        const searchA = await call(secretA, 'search_members', { status: 'all' })
        expect(searchA.structuredContent!.total).toBe(2)
        expect(JSON.stringify(searchA)).not.toContain(borisRef)
        const foreignGroup = await call(secretB, 'schedule', { groupId: c.bjjGroup.id })
        expect(foreignGroup.isError).toBe(true)
        expect((await call(secretB, 'club_overview')).structuredContent).toMatchObject({
            members: { total: 1 },
            attendance: { checkins30d: 0 },
        })

        // The management routes are club-bound too.
        await http().get(`/workspaces/${c.b.w}/ai-tokens`).set(...c.ownerActor.auth).expect(403)
        await http()
            .delete(`/workspaces/${c.w}/ai-tokens/${createdB.body.token.id}`)
            .set(...c.ownerActor.auth)
            .expect(404)
        await createToken(c.ownerActor, c.b.w).expect(403)
    })

    it('revoked, expired and foreign credentials get 401', async () => {
        const c = await setup()
        const created = await createToken(c.ownerActor, c.w).expect(201)
        const secret = created.body.secret as string
        await rpc(secret, 'ping').expect(200)

        // A user's JWT is not an MCP token.
        const jwt = await http()
            .post('/mcp')
            .set(...c.ownerActor.auth)
            .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
            .expect(401)
        expect(jwt.body.error.code).toBe(-32001)
        expect(jwt.headers['www-authenticate']).toContain('Bearer')
        await http().post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' }).expect(401)
        await rpc(`${secret}x`, 'ping').expect(401)

        const revoked = await http()
            .delete(`/workspaces/${c.w}/ai-tokens/${created.body.token.id}`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(revoked.body.state).toBe('revoked')
        const afterRevoke = await rpc(secret, 'ping').expect(401)
        expect(afterRevoke.body.error.message).toBe('Токен отозван')

        const second = await createToken(c.ownerActor, c.w).expect(201)
        await ctx.prisma.aiAccessToken.update({
            where: { id: second.body.token.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        })
        const expired = await rpc(second.body.secret, 'tools/call', { name: 'club_overview' }).expect(401)
        expect(expired.body.error.message).toBe('Срок действия токена истёк')

        // A creator who lost the role takes the token's access with them.
        const managerToken = await createToken(c.manager, c.w).expect(201)
        await ctx.prisma.directionManager.deleteMany({ where: { userId: c.managerUser.id } })
        await rpc(managerToken.body.secret, 'ping').expect(403)
    })

    it('a direction manager token sees only its directions and no money', async () => {
        const c = await setup()
        // A plain coach has no ИИ-ассистент; a manager can't go personal.
        await createToken(c.coach, c.w).expect(403)
        await createToken(c.manager, c.w, {
            dataMode: 'PERSONAL',
            personalDataWarningVersion: AI_PERSONAL_DATA_WARNING.version,
        }).expect(403)
        const created = await createToken(c.manager, c.w).expect(201)
        const secret = created.body.secret as string

        const tools = (await rpc(secret, 'tools/list').expect(200)).body.result.tools as { name: string }[]
        const names = tools.map((t) => t.name)
        expect(names).toContain('search_members')
        expect(names).not.toContain('revenue_report')
        expect(names).not.toContain('unpaid_abonements')
        expect((await call(secret, 'revenue_report')).isError).toBe(true)

        const directory = (await call(secret, 'club_directory')).structuredContent!
        expect(directory).toMatchObject({
            directions: [{ name: 'БЖЖ' }],
            groups: [{ name: 'БЖЖ взрослые' }],
        })

        const members = (await call(secret, 'search_members', { status: 'all' })).structuredContent!
        expect(members).toMatchObject({ total: 1, items: [{ groups: [{ name: 'БЖЖ взрослые' }] }] })

        const schedule = (await call(secret, 'schedule')).structuredContent!
        expect(schedule.items!.length).toBeGreaterThan(0)
        expect(new Set(schedule.items!.map((s) => s.direction))).toEqual(new Set(['БЖЖ']))
        expect(schedule).toMatchObject({ events: [{ title: 'Семинар по БЖЖ' }] })

        const overview = (await call(secret, 'club_overview')).structuredContent!
        expect(overview).toMatchObject({ members: { total: 1 }, attendance: { checkins30d: 2 }, money: null })
        expect((await call(secret, 'attendance_stats')).structuredContent!.checkins).toBe(2)
        expect((await call(secret, 'schedule', { directionId: c.mma })).isError).toBe(true)
        expect((await call(secret, 'list_events')).structuredContent!.items).toHaveLength(1)

        // The manager lists and revokes only their own tokens.
        const ownerToken = await createToken(c.ownerActor, c.w).expect(201)
        const listed = await http().get(`/workspaces/${c.w}/ai-tokens`).set(...c.manager.auth).expect(200)
        expect(listed.body.data.map((t: { id: string }) => t.id)).toEqual([created.body.token.id])
        expect(listed.body.canUsePersonalData).toBe(false)
        await http()
            .delete(`/workspaces/${c.w}/ai-tokens/${ownerToken.body.token.id}`)
            .set(...c.manager.auth)
            .expect(403)
        const ownerList = await http().get(`/workspaces/${c.w}/ai-tokens`).set(...c.ownerActor.auth).expect(200)
        expect(ownerList.body.data).toHaveLength(2)
        expect(ownerList.body.mcpUrl).toMatch(/\/mcp$/)
    })

    it('audits token management and every tool call', async () => {
        const c = await setup()
        const created = await createToken(c.ownerActor, c.w).expect(201)
        const tokenId = created.body.token.id as string
        await call(created.body.secret, 'search_members', { status: 'all', limit: 5 })
        await call(created.body.secret, 'revenue_report', { months: 3 })

        const events = await ctx.prisma.auditEvent.findMany({
            where: { workspaceId: c.w, targetId: tokenId },
            orderBy: { createdAt: 'asc' },
        })
        expect(events.map((e) => e.action)).toEqual(['ai.tokenCreate', 'ai.toolCall', 'ai.toolCall'])
        expect(events[1]).toMatchObject({
            actorId: c.owner.id,
            targetType: 'aiToken',
            metadata: expect.objectContaining({
                tool: 'search_members',
                args: { status: 'all', limit: 5 },
                rows: 2,
                isError: false,
                tokenName: 'Claude Desktop',
            }),
        })
        expect(events[2].metadata).toMatchObject({ tool: 'revenue_report', args: { months: 3 } })
    })

    it('rate-limits each token', async () => {
        const c = await setup()
        const secret = (await createToken(c.ownerActor, c.w).expect(201)).body.secret as string
        const other = (await createToken(c.ownerActor, c.w).expect(201)).body.secret as string
        for (let i = 0; i < 60; i++) await rpc(secret, 'ping').expect(200)
        const limited = await rpc(secret, 'ping').expect(429)
        expect(limited.body.error.code).toBe(-32029)
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
        // Another token of the same club has its own bucket.
        await rpc(other, 'ping').expect(200)
    })
})
