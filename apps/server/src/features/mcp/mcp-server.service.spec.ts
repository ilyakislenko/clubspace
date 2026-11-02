import { generateAiToken } from '../../domains/ai-assistant/ai-token'
import { RbacService } from '../../shared/services/rbac.service'
import { JSONRPC } from './mcp-protocol'
import { McpServerService } from './mcp-server.service'

const { secret, hash } = generateAiToken()

type Opts = {
    token?: Record<string, unknown> | null
    role?: 'owner' | 'admin' | 'manager' | 'coach'
    blocked?: boolean
    bus?: { execute: jest.Mock }
}

const setup = (opts: Opts = {}) => {
    const role = opts.role ?? 'owner'
    const token =
        opts.token === null
            ? null
            : {
                  id: 't1',
                  workspaceId: 'w1',
                  name: 'Claude',
                  scopes: ['read'],
                  dataMode: 'PSEUDONYMIZED',
                  expiresAt: null,
                  revokedAt: null,
                  lastUsedAt: null,
                  createdById: 'u1',
                  createdBy: { status: 'ACTIVE', email: 'u1@x.ru' },
                  workspace: { name: 'Клуб', isActive: true, billing: null },
                  ...opts.token,
              }
    const prisma = {
        aiAccessToken: {
            findUnique: jest.fn().mockResolvedValue(token),
            update: jest.fn().mockResolvedValue({}),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                name: 'Клуб',
                timezone: 'Europe/Moscow',
                ownerId: role === 'owner' ? 'u1' : 'owner',
                coachSeesAllGroups: true,
            }),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(
                role === 'owner'
                    ? null
                    : { status: 'ACTIVE', accessUntil: null, role: { name: role === 'admin' ? 'admin' : 'coach' } },
            ),
        },
        directionManager: {
            findMany: jest.fn().mockResolvedValue(role === 'manager' ? [{ directionId: 'bjj' }] : []),
        },
        direction: { findMany: jest.fn().mockResolvedValue([{ id: 'bjj', name: 'БЖЖ', isActive: true }]) },
        gym: { findMany: jest.fn().mockResolvedValue([]) },
        group: { findMany: jest.fn().mockResolvedValue([]) },
        plan: { findMany: jest.fn().mockResolvedValue([]) },
        rankLadder: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const redis = { eval: jest.fn().mockResolvedValue([1, 60_000, opts.blocked ? 1 : 0, opts.blocked ? 42_000 : 0]) }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const service = new McpServerService(
        prisma as never,
        new RbacService(prisma as never),
        audit as never,
        (opts.bus ?? {}) as never,
        {} as never,
        redis as never,
    )
    // null = no Authorization header.
    const post = (body: unknown, auth: string | null = `Bearer ${secret}`, protocolVersion?: string) =>
        service.handleHttp({ authorization: auth ?? undefined, protocolVersion, body })
    const request = (method: string, params?: Record<string, unknown>) =>
        post({ jsonrpc: '2.0', id: 7, method, ...(params ? { params } : {}) })
    return { prisma, redis, audit, post, request }
}

describe('McpServerService — auth and transport', () => {
    it.each([
        ['no header', null],
        ['a user JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'],
        ['a malformed header', `Token ${secret}`],
    ])('answers %s with 401 before touching the database', async (_label, auth) => {
        const s = setup()
        const res = await s.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, auth)
        expect(res.status).toBe(401)
        expect(res.headers?.['WWW-Authenticate']).toContain('Bearer')
        expect(res.body).toMatchObject({ error: { code: JSONRPC.UNAUTHORIZED } })
        expect(s.prisma.aiAccessToken.findUnique).not.toHaveBeenCalled()
    })

    it.each([
        ['an unknown token', { token: null }, 'Токен не найден'],
        ['a revoked token', { token: { revokedAt: new Date('2026-01-01') } }, 'Токен отозван'],
        ['an expired token', { token: { expiresAt: new Date('2026-01-01') } }, 'Срок действия токена истёк'],
        [
            'a blocked creator',
            { token: { createdBy: { status: 'BLOCKED', email: null } } },
            'Аккаунт создателя токена заблокирован или удалён',
        ],
    ])('answers %s with 401', async (_label, opts, message) => {
        const s = setup(opts as Opts)
        const res = await s.request('ping')
        expect(res.status).toBe(401)
        expect(res.body).toMatchObject({ error: { message } })
    })

    it('looks the token up by its hash', async () => {
        const s = setup()
        await s.request('ping')
        expect(s.prisma.aiAccessToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hash })
    })

    it('answers 403 when the creator lost their rights or the club is closed', async () => {
        expect((await setup({ role: 'coach' }).request('ping')).status).toBe(403)
        const closed = await setup({ token: { workspace: { name: 'Клуб', isActive: false, billing: null } } }).request('ping')
        expect(closed.status).toBe(403)
        expect(closed.body).toMatchObject({ error: { code: JSONRPC.FORBIDDEN } })
    })

    it('rate-limits per token with 429 and Retry-After', async () => {
        const s = setup({ blocked: true })
        const res = await s.request('ping')
        expect(res.status).toBe(429)
        expect(res.headers?.['Retry-After']).toBe('42')
        expect(res.body).toMatchObject({ error: { code: JSONRPC.RATE_LIMITED } })
        expect(s.redis.eval.mock.calls[0][2]).toContain('ai-mcp:token:t1')
    })

    it('stamps lastUsedAt at most once a minute', async () => {
        const fresh = setup({ token: { lastUsedAt: new Date() } })
        await fresh.request('ping')
        expect(fresh.prisma.aiAccessToken.update).not.toHaveBeenCalled()
        const stale = setup({ token: { lastUsedAt: new Date('2026-01-01') } })
        await stale.request('ping')
        expect(stale.prisma.aiAccessToken.update.mock.calls[0][0].where).toEqual({ id: 't1' })
    })

    it('refuses an unknown protocol version header and batches', async () => {
        const s = setup()
        expect((await s.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, null)).status).toBe(401)
        expect(
            (await s.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, `Bearer ${secret}`, '1999-01-01')).status,
        ).toBe(400)
        expect((await s.post([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).status).toBe(400)
    })

    it('accepts notifications with 202 and no body', async () => {
        const res = await setup().post({ jsonrpc: '2.0', method: 'notifications/initialized' })
        expect(res).toEqual({ status: 202 })
    })
})

describe('McpServerService — methods', () => {
    it('initializes with tools capability, server info and instructions', async () => {
        const res = await setup().request('initialize', { protocolVersion: '2025-06-18' })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            id: 7,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'clubspace' },
            },
        })
        expect((res.body as { result: { instructions: string } }).result.instructions).toContain('обезличено')
    })

    it('lists the money tools for admin scope only', async () => {
        const names = async (role: Opts['role']) =>
            ((await setup({ role }).request('tools/list')).body as { result: { tools: { name: string }[] } }).result.tools.map(
                (t) => t.name,
            )
        expect(await names('admin')).toContain('revenue_report')
        const manager = await names('manager')
        expect(manager).toContain('search_members')
        expect(manager).not.toContain('revenue_report')
        expect(manager).not.toContain('renewals_due')
    })

    it('answers unknown methods and tools with JSON-RPC errors', async () => {
        const s = setup()
        expect((await s.request('resources/list')).body).toMatchObject({ error: { code: JSONRPC.METHOD_NOT_FOUND } })
        expect((await s.request('tools/call', { name: 'nope' })).body).toMatchObject({
            error: { code: JSONRPC.INVALID_PARAMS },
        })
        expect((await s.request('tools/call', { name: 'club_directory', arguments: [] })).body).toMatchObject({
            error: { code: JSONRPC.INVALID_PARAMS },
        })
        expect(s.audit.record).not.toHaveBeenCalled()
    })

    it('runs a tool, returns text + structured content, and audits it', async () => {
        const s = setup()
        const res = await s.request('tools/call', { name: 'club_directory', arguments: {} })
        const result = (res.body as { result: { isError: boolean; structuredContent: { directions: unknown[] }; content: { text: string }[] } }).result
        expect(result.isError).toBe(false)
        expect(result.structuredContent.directions).toEqual([{ id: 'bjj', name: 'БЖЖ', isActive: true }])
        expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'ai.toolCall',
            targetType: 'aiToken',
            targetId: 't1',
            workspaceId: 'w1',
            actorId: 'u1',
            metadata: { tool: 'club_directory', rows: 1, isError: false, tokenName: 'Claude', dataMode: 'PSEUDONYMIZED' },
        })
    })

    it('tags groups and tariffs with the ref the admin chat links to their pages', async () => {
        const s = setup()
        s.prisma.group.findMany.mockResolvedValue([
            { id: 'g1', name: 'Дети', gym: null, direction: null, _count: { members: 3 }, coaches: [] },
        ])
        s.prisma.plan.findMany.mockResolvedValue([
            {
                id: 'p1',
                name: '8 занятий',
                price: 4000,
                currency: 'RUB',
                classCount: 8,
                durationDays: 30,
                isFreeTrial: false,
                startsOnFirstVisit: false,
                directions: [],
            },
        ])
        const res = await s.request('tools/call', { name: 'club_directory', arguments: {} })
        const data = (res.body as { result: { structuredContent: { groups: unknown[]; tariffs: unknown[] } } }).result
            .structuredContent
        expect(data.groups).toEqual([expect.objectContaining({ id: 'g1', ref: '[group:g1]', name: 'Дети' })])
        expect(data.tariffs).toEqual([expect.objectContaining({ id: 'p1', ref: '[plan:p1]' })])
    })

    it('tags the tariff in renewals and debts too (an archived one included) without naming the member', async () => {
        const P = '11111111-1111-4111-8111-111111111111'
        const bus = {
            execute: jest
                .fn()
                .mockResolvedValueOnce({
                    data: [
                        {
                            userId: 'm1',
                            firstname: 'Иван',
                            lastname: 'Петров',
                            email: 'ivan@x.ru',
                            reason: 'low_classes',
                            classesRemaining: 1,
                            classesTotal: 8,
                            accessUntil: null,
                            planId: P,
                            planName: 'Старый тариф',
                            endDate: null,
                            directions: [],
                        },
                        {
                            userId: 'm2',
                            firstname: null,
                            lastname: null,
                            email: null,
                            reason: 'access_expiring',
                            classesRemaining: null,
                            classesTotal: null,
                            accessUntil: '2026-11-05T00:00:00.000Z',
                            planId: null,
                            planName: null,
                            endDate: null,
                            directions: [],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    total: 1,
                    data: [
                        {
                            subscriptionId: 's1',
                            userId: 'm1',
                            memberName: 'Иван Петров',
                            memberPhone: '+79990000000',
                            planId: P,
                            planName: 'Старый тариф',
                            amount: 5000,
                            currency: 'RUB',
                            startDate: null,
                            createdAt: '2026-10-01T10:00:00.000Z',
                        },
                    ],
                }),
        }
        const s = setup({ bus })
        const structured = async (name: string) => {
            const res = await s.request('tools/call', { name, arguments: {} })
            return (res.body as { result: { structuredContent: { items: Record<string, unknown>[] } } }).result
                .structuredContent
        }
        const renewals = await structured('renewals_due')
        expect(renewals.items.map((i) => i.tariffRef)).toEqual([`[plan:${P}]`, null])
        const debts = await structured('unpaid_abonements')
        expect(debts.items[0]).toMatchObject({ tariff: 'Старый тариф', tariffRef: `[plan:${P}]` })
        const text = JSON.stringify([renewals, debts])
        expect(text).not.toContain('Иван')
        expect(text).not.toContain('+7999')
    })

    it.each([
        ['money for a direction manager', 'manager', 'revenue_report', {}, 'администратора'],
        ['invalid arguments', 'owner', 'schedule', { from: 'вчера' }, 'Некорректные аргументы'],
        ['a bad member ref', 'owner', 'member_profile', { member: 'Иван' }, 'ref'],
    ] as const)('returns %s as an audited tool error', async (_label, role, name, args, text) => {
        const s = setup({ role })
        const res = await s.request('tools/call', { name, arguments: args })
        const result = (res.body as { result: { isError: boolean; content: { text: string }[] } }).result
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain(text)
        expect(s.audit.record.mock.calls[0][0].metadata).toMatchObject({ tool: name, isError: true, rows: 0 })
    })

    it('hides internal failures behind a generic tool error', async () => {
        const s = setup()
        s.prisma.direction.findMany.mockRejectedValue(new Error('connection reset by 10.0.0.5'))
        const res = await s.request('tools/call', { name: 'club_directory' })
        const result = (res.body as { result: { isError: boolean; content: { text: string }[] } }).result
        expect(result.isError).toBe(true)
        expect(result.content[0].text).not.toContain('10.0.0.5')
    })
})
