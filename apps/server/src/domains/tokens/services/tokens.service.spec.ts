import { JwtService } from '@nestjs/jwt'

import { TokenNotFoundError, TokenRevokedError } from '../errors/tokens.errors'
import { TokensService } from './tokens.service'

const CONFIG = {
    jwt: {
        secret: 'test-secret-long-enough-for-hs256-token-signing',
        issuerUrl: 'http://localhost:3000',
        accessTokenTTL: 900,
        refreshTokenTTL: 2_592_000, // 30 days, in SECONDS
    },
    test: false,
}

type RefreshRow = { id: string; tokenHash: string; isRevoked: boolean }

const buildPrisma = () => {
    const created: RefreshRow[] = []
    return {
        created,
        refreshToken: {
            create: jest.fn(({ data }: { data: any }) => {
                created.push(data)
                return Promise.resolve(data)
            }),
            findUnique: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
    }
}

const build = () => {
    const prisma = buildPrisma()
    const service = new TokensService(
        CONFIG as never,
        new JwtService(),
        prisma as never,
    )
    return { service, prisma }
}

describe('TokensService', () => {
    it('round-trips an access token back to its claims', async () => {
        const { service } = build()
        const token = await service.generateToken({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
        const decoded = await service.verifyToken<{
            sub: string
            workspaceId: string
        }>(token)
        expect(decoded.sub).toBe('user-1')
        expect(decoded.workspaceId).toBe('ws-1')
    })

    it('stores the refresh token expiry in the future by ~TTL seconds (not ms)', async () => {
        const { service, prisma } = build()
        const before = Date.now()
        await service.generateStoredToken({ userId: 'user-1' })

        const data = prisma.refreshToken.create.mock.calls[0][0].data
        const expiresAtMs = new Date(data.expiresAt).getTime()
        const ttlMs = CONFIG.jwt.refreshTokenTTL * 1000

        // Regression guard for the seconds-as-ms bug: must be ~30 days out.
        expect(expiresAtMs).toBeGreaterThan(before + ttlMs - 5_000)
        expect(expiresAtMs).toBeLessThan(Date.now() + ttlMs + 5_000)
    })

    it('persists a sha256 hash of the token, never the token itself', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        const data = prisma.refreshToken.create.mock.calls[0][0].data
        expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/)
        expect(data.tokenHash).not.toBe(token)
        expect(data.isRevoked).toBe(false)
    })

    it('verifies a stored token that exists and is not revoked', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        const jti = prisma.refreshToken.create.mock.calls[0][0].data.id
        prisma.refreshToken.findUnique.mockResolvedValue({
            id: jti,
            isRevoked: false,
        })

        const decoded = await service.verifyStoredToken({ token })
        expect(decoded.jti).toBe(jti)
        expect(decoded.sub).toBe('user-1')
    })

    it('rejects a stored token whose row is gone', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        prisma.refreshToken.findUnique.mockResolvedValue(null)
        await expect(service.verifyStoredToken({ token })).rejects.toBeInstanceOf(
            TokenNotFoundError,
        )
    })

    it('rejects a revoked stored token', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        const jti = prisma.refreshToken.create.mock.calls[0][0].data.id
        prisma.refreshToken.findUnique.mockResolvedValue({
            id: jti,
            isRevoked: true,
        })
        await expect(service.verifyStoredToken({ token })).rejects.toBeInstanceOf(
            TokenRevokedError,
        )
    })

    it('revokes a stored token by jti', async () => {
        const { service, prisma } = build()
        await service.revokeStoredToken({ jti: 'jti-123' })
        expect(prisma.refreshToken.update).toHaveBeenCalledWith({
            where: { id: 'jti-123' },
            data: { isRevoked: true },
        })
    })
})
