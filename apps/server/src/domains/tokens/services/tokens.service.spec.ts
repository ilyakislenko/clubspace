import { JwtService } from '@nestjs/jwt'

import {
    TokenExpiredError,
    TokenMalformedError,
    TokenNotFoundError,
    TokenRevokedError,
} from '../errors/tokens.errors'
import { TokensService } from './tokens.service'

const CONFIG = {
    jwt: {
        secret: 'test-secret-long-enough-for-hs256-token-signing',
        issuerUrl: 'http://localhost:3000',
        audienceUrl: 'http://localhost:3000/aud',
        accessTokenTTL: 900,
        refreshTokenTTL: 2_592_000, // 30 days, in SECONDS
    },
    test: false,
}

type RefreshRow = {
    id: string
    tokenHash: string
    isRevoked: boolean
    familyId: string
}

const buildPrisma = () => {
    const created: RefreshRow[] = []
    return {
        created,
        refreshToken: {
            create: jest.fn(({ data }: { data: RefreshRow }) => {
                created.push(data)
                return Promise.resolve(data)
            }),
            findUnique: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
}

const build = () => {
    const prisma = buildPrisma()
    const jwt = new JwtService()
    const service = new TokensService(CONFIG as never, jwt, prisma as never)
    return { service, prisma, jwt }
}

// Signs arbitrary claims with the real secret/issuer/audience, i.e. a token
// the service itself could have minted before `typ` existed.
const signRaw = (
    jwt: JwtService,
    claims: object,
    options: { audience?: string; expiresIn?: number } = {},
) =>
    jwt.signAsync(claims, {
        secret: CONFIG.jwt.secret,
        issuer: CONFIG.jwt.issuerUrl,
        audience: options.audience ?? CONFIG.jwt.audienceUrl,
        expiresIn: options.expiresIn ?? 900,
        subject: 'user-1',
    })

describe('TokensService — access tokens', () => {
    it('round-trips an access token with its type and session version', async () => {
        const { service } = build()
        const token = await service.generateToken({
            userId: 'user-1',
            sessionVersion: 3,
        })
        const decoded = await service.verifyToken<{ aud: string }>(token)
        expect(decoded).toMatchObject({ sub: 'user-1', typ: 'access', sv: 3 })
        expect(decoded.aud).toBe(CONFIG.jwt.audienceUrl)
    })

    it('refuses a refresh token presented as an access token', async () => {
        const { service } = build()
        const refresh = await service.generateStoredToken({ userId: 'user-1' })
        await expect(service.verifyToken(refresh)).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })

    it('refuses a legacy token without a type', async () => {
        const { service, jwt } = build()
        const legacy = await signRaw(jwt, {})
        await expect(service.verifyToken(legacy)).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })

    it('refuses an access token without a session version', async () => {
        const { service, jwt } = build()
        const token = await signRaw(jwt, { typ: 'access' })
        await expect(service.verifyToken(token)).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })

    it('refuses a token minted for another audience', async () => {
        const { service, jwt } = build()
        const token = await signRaw(
            jwt,
            { typ: 'access', sv: 0 },
            { audience: CONFIG.jwt.issuerUrl },
        )
        await expect(service.verifyToken(token)).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })

    it('reports an expired token as expired', async () => {
        const { service, jwt } = build()
        const token = await signRaw(
            jwt,
            { typ: 'access', sv: 0 },
            { expiresIn: -10 },
        )
        await expect(service.verifyToken(token)).rejects.toBeInstanceOf(
            TokenExpiredError,
        )
    })

    it('refuses garbage', async () => {
        const { service } = build()
        await expect(service.verifyToken('not-a-jwt')).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })
})

describe('TokensService — refresh tokens', () => {
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

    it('starts a new family on sign-in and carries one forward on rotation', async () => {
        const { service, prisma } = build()
        await service.generateStoredToken({ userId: 'user-1' })
        await service.generateStoredToken({ userId: 'user-1' })
        await service.generateStoredToken({
            userId: 'user-1',
            familyId: 'fam-1',
        })
        const [first, second, rotated] = prisma.created
        expect(first.familyId).toEqual(expect.any(String))
        expect(second.familyId).not.toBe(first.familyId)
        expect(rotated.familyId).toBe('fam-1')
    })

    it('verifies a stored token that exists and is not revoked', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        const { id: jti, familyId } = prisma.created[0]
        prisma.refreshToken.findUnique.mockResolvedValue({
            isRevoked: false,
            familyId,
        })

        const decoded = await service.verifyStoredToken({ token })
        expect(decoded).toMatchObject({
            jti,
            sub: 'user-1',
            typ: 'refresh',
            familyId,
        })
    })

    it('refuses an access token presented as a refresh token', async () => {
        const { service, prisma } = build()
        const access = await service.generateToken({
            userId: 'user-1',
            sessionVersion: 0,
        })
        await expect(
            service.verifyStoredToken({ token: access }),
        ).rejects.toBeInstanceOf(TokenMalformedError)
        expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled()
    })

    it('refuses a legacy refresh token without a type', async () => {
        const { service, jwt, prisma } = build()
        const legacy = await jwt.signAsync(
            {},
            {
                secret: CONFIG.jwt.secret,
                issuer: CONFIG.jwt.issuerUrl,
                audience: CONFIG.jwt.issuerUrl,
                expiresIn: 900,
                subject: 'user-1',
                jwtid: 'legacy-jti',
            },
        )
        await expect(
            service.verifyStoredToken({ token: legacy }),
        ).rejects.toBeInstanceOf(TokenMalformedError)
        expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled()
    })

    it('rejects a stored token whose row is gone', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        prisma.refreshToken.findUnique.mockResolvedValue(null)
        await expect(service.verifyStoredToken({ token })).rejects.toBeInstanceOf(
            TokenNotFoundError,
        )
    })

    it('rejects a row from before families existed', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        prisma.refreshToken.findUnique.mockResolvedValue({
            isRevoked: false,
            familyId: null,
        })
        await expect(service.verifyStoredToken({ token })).rejects.toBeInstanceOf(
            TokenMalformedError,
        )
    })

    it('treats a revoked token as reuse and revokes its whole family', async () => {
        const { service, prisma } = build()
        const token = await service.generateStoredToken({ userId: 'user-1' })
        prisma.refreshToken.findUnique.mockResolvedValue({
            isRevoked: true,
            familyId: 'fam-1',
        })
        await expect(service.verifyStoredToken({ token })).rejects.toBeInstanceOf(
            TokenRevokedError,
        )
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { familyId: 'fam-1', isRevoked: false },
            data: { isRevoked: true },
        })
    })

    it('rotates a live token with a conditional update', async () => {
        const { service, prisma } = build()
        await service.rotateStoredToken({ jti: 'jti-1', familyId: 'fam-1' })
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1)
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { id: 'jti-1', isRevoked: false },
            data: { isRevoked: true, lastUsedAt: expect.any(Date) },
        })
    })

    it('loses a rotation race as reuse: the family is revoked', async () => {
        const { service, prisma } = build()
        prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 })
        await expect(
            service.rotateStoredToken({ jti: 'jti-1', familyId: 'fam-1' }),
        ).rejects.toBeInstanceOf(TokenRevokedError)
        expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
            where: { familyId: 'fam-1', isRevoked: false },
            data: { isRevoked: true },
        })
    })
})
