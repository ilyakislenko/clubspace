import { hashAiToken } from '../../domains/ai-assistant/ai-token'
import { AI_PERSONAL_DATA_WARNING } from '../../domains/ai-assistant/personal-data-warning'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateAiTokenFeature,
    ListAiTokensFeature,
    RevokeAiTokenFeature,
} from './ai-tokens.feature'
import {
    CreateAiTokenHandler,
    ListAiTokensHandler,
    MAX_ACTIVE_AI_TOKENS,
    OWNER_ONLY_PERSONAL_MESSAGE,
    RevokeAiTokenHandler,
} from './ai-tokens.handler'

type Role = 'owner' | 'admin' | 'manager' | 'coach' | 'user'

const MEMBER_ROLE: Record<Exclude<Role, 'owner'>, string> = {
    admin: 'admin',
    manager: 'coach',
    coach: 'coach',
    user: 'user',
}

const tokenRow = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    name: 'Claude',
    tokenPrefix: 'csai_abcde',
    scopes: ['read'],
    dataMode: 'PSEUDONYMIZED',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    createdById: 'manager',
    createdBy: { id: 'manager', firstname: 'Глеб', lastname: null, email: 'g@x.ru' },
    ...over,
})

const setup = (invoker: Role, opts: { activeTokens?: number; found?: Record<string, unknown> | null } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                name: 'Клуб',
                timezone: 'Europe/Moscow',
                ownerId: 'owner',
                coachSeesAllGroups: true,
            }),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(
                invoker === 'owner'
                    ? null
                    : { status: 'ACTIVE', accessUntil: null, role: { name: MEMBER_ROLE[invoker] } },
            ),
        },
        directionManager: {
            findMany: jest
                .fn()
                .mockResolvedValue(invoker === 'manager' ? [{ directionId: 'bjj' }] : []),
        },
        aiAccessToken: {
            findMany: jest.fn().mockResolvedValue([tokenRow()]),
            count: jest.fn().mockResolvedValue(opts.activeTokens ?? 0),
            create: jest.fn().mockImplementation(async ({ data }) =>
                tokenRow({ ...data, id: 'new', createdAt: new Date(), createdBy: { id: data.createdById, firstname: null, lastname: null, email: 'x@y.ru' } }),
            ),
            findFirst: jest.fn().mockResolvedValue(opts.found === undefined ? tokenRow() : opts.found),
            update: jest.fn().mockImplementation(async ({ data }) => tokenRow({ ...opts.found, ...data })),
        },
        aiDataTransferAcceptance: { create: jest.fn().mockResolvedValue({}) },
        user: {
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ firstname: 'Олег', lastname: 'Владельцев', email: 'owner@x.ru' }),
        },
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = new RbacService(prisma as never)
    return { prisma, audit, rbac }
}

const createInput = (over: Record<string, unknown> = {}) => ({
    name: 'Claude Desktop',
    dataMode: 'PSEUDONYMIZED' as const,
    expiresInDays: 90,
    scopes: ['read' as const],
    ...over,
})

describe('ListAiTokensHandler', () => {
    const list = (invoker: Role) => {
        const s = setup(invoker)
        const handler = new ListAiTokensHandler(s.prisma as never, s.rbac)
        return { ...s, run: () => handler.execute(new ListAiTokensFeature('w1', invoker)) }
    }

    it('shows an admin every token of the club', async () => {
        const s = list('admin')
        const res = await s.run()
        expect(s.prisma.aiAccessToken.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1' })
        expect(res.data[0]).toMatchObject({ id: 't1', state: 'active', canRevoke: true })
        expect(res.canUsePersonalData).toBe(false)
        expect(res.personalDataWarning.version).toBe(AI_PERSONAL_DATA_WARNING.version)
    })

    it('shows a direction manager only their own tokens', async () => {
        const s = list('manager')
        await s.run()
        expect(s.prisma.aiAccessToken.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            createdById: 'manager',
        })
    })

    it('lets only the owner use personal data', async () => {
        expect((await list('owner').run()).canUsePersonalData).toBe(true)
    })

    it.each<Role>(['coach', 'user'])('refuses a %s', async (role) => {
        await expect(list(role).run()).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('CreateAiTokenHandler', () => {
    const create = (invoker: Role, input = createInput(), opts: { activeTokens?: number } = {}) => {
        const s = setup(invoker, opts)
        const handler = new CreateAiTokenHandler(s.prisma as never, s.rbac, s.audit as never)
        return {
            ...s,
            run: () =>
                handler.execute(new CreateAiTokenFeature(input, 'w1', invoker, '10.0.0.1', 'Claude/1.0')),
        }
    }

    it('stores only the hash and returns the secret once', async () => {
        const s = create('manager')
        const res = await s.run()
        const data = s.prisma.aiAccessToken.create.mock.calls[0][0].data
        expect(res.secret).toMatch(/^csai_/)
        expect(data.tokenHash).toBe(hashAiToken(res.secret))
        expect(JSON.stringify(data)).not.toContain(res.secret)
        expect(data).toMatchObject({ workspaceId: 'w1', createdById: 'manager', scopes: ['read'], dataMode: 'PSEUDONYMIZED' })
        expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 24 * 3600_000)
        expect(s.prisma.aiDataTransferAcceptance.create).not.toHaveBeenCalled()
        expect(s.audit.record.mock.calls.map((c) => c[0].action)).toEqual(['ai.tokenCreate'])
    })

    it('records the owner’s acceptance with a personal token', async () => {
        const s = create(
            'owner',
            createInput({
                dataMode: 'PERSONAL',
                expiresInDays: null,
                personalDataWarningVersion: AI_PERSONAL_DATA_WARNING.version,
            }),
        )
        const res = await s.run()
        expect(res.token.dataMode).toBe('PERSONAL')
        expect(s.prisma.aiDataTransferAcceptance.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'w1',
            userId: 'owner',
            userEmail: 'owner@x.ru',
            userName: 'Олег Владельцев',
            warningVersion: AI_PERSONAL_DATA_WARNING.version,
            tokenId: 'new',
            ip: '10.0.0.1',
            userAgent: 'Claude/1.0',
        })
        expect(s.audit.record.mock.calls.map((c) => c[0].action)).toEqual([
            'ai.personalDataAccept',
            'ai.tokenCreate',
        ])
    })

    it('refuses personal data to anyone but the owner', async () => {
        const s = create(
            'admin',
            createInput({ dataMode: 'PERSONAL', personalDataWarningVersion: AI_PERSONAL_DATA_WARNING.version }),
        )
        await expect(s.run()).rejects.toThrow(OWNER_ONLY_PERSONAL_MESSAGE)
        expect(s.prisma.aiAccessToken.create).not.toHaveBeenCalled()
    })

    it('requires the current warning edition', async () => {
        await expect(create('owner', createInput({ dataMode: 'PERSONAL' })).run()).rejects.toBeInstanceOf(
            BadRequestError,
        )
        await expect(
            create('owner', createInput({ dataMode: 'PERSONAL', personalDataWarningVersion: 'old' })).run(),
        ).rejects.toBeInstanceOf(ConflictError)
    })

    it('does not grant the action scope yet', async () => {
        await expect(create('owner', createInput({ scopes: ['read', 'actions'] })).run()).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('accepts only the offered lifetimes', async () => {
        await expect(create('owner', createInput({ expiresInDays: 7 })).run()).rejects.toBeInstanceOf(BadRequestError)
    })

    it('caps live tokens per club', async () => {
        await expect(
            create('owner', createInput(), { activeTokens: MAX_ACTIVE_AI_TOKENS }).run(),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it.each<Role>(['coach', 'user'])('refuses a %s', async (role) => {
        const s = create(role)
        await expect(s.run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(s.prisma.aiAccessToken.create).not.toHaveBeenCalled()
    })
})

describe('RevokeAiTokenHandler', () => {
    const revoke = (invoker: Role, found: Record<string, unknown> | null = tokenRow()) => {
        const s = setup(invoker, { found })
        const handler = new RevokeAiTokenHandler(s.prisma as never, s.rbac, s.audit as never)
        return { ...s, run: () => handler.execute(new RevokeAiTokenFeature('w1', 't1', invoker)) }
    }

    it('lets an admin revoke anyone’s token, audited', async () => {
        const s = revoke('admin')
        const res = await s.run()
        expect(s.prisma.aiAccessToken.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', workspaceId: 'w1' })
        expect(s.prisma.aiAccessToken.update.mock.calls[0][0].data).toMatchObject({ revokedById: 'admin' })
        expect(res.state).toBe('revoked')
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({ action: 'ai.tokenRevoke', targetId: 't1' })
    })

    it('lets a direction manager revoke their own token only', async () => {
        await expect(revoke('manager').run()).resolves.toMatchObject({ state: 'revoked' })
        const other = revoke('manager', tokenRow({ createdById: 'someone' }))
        await expect(other.run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(other.prisma.aiAccessToken.update).not.toHaveBeenCalled()
    })

    it('is a no-op on an already revoked token', async () => {
        const s = revoke('admin', tokenRow({ revokedAt: new Date('2026-10-01') }))
        await expect(s.run()).resolves.toMatchObject({ state: 'revoked' })
        expect(s.prisma.aiAccessToken.update).not.toHaveBeenCalled()
        expect(s.audit.record).not.toHaveBeenCalled()
    })

    it('does not find another club’s token', async () => {
        await expect(revoke('admin', null).run()).rejects.toBeInstanceOf(NotFoundError)
    })
})
