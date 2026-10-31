import { JwtService } from '@nestjs/jwt'

import { TokensService } from '../tokens/services/tokens.service'
import { RealtimeGateway } from './realtime.gateway'

// A real TokensService: the point is that the gateway applies the same token
// rules as AuthGuard, not that a stub said no.
const tokens = new TokensService(
    {
        jwt: {
            secret: 'test-secret-long-enough-for-hs256-token-signing',
            issuerUrl: 'http://localhost:3000',
            audienceUrl: 'http://localhost:3000',
            accessTokenTTL: 900,
            refreshTokenTTL: 3600,
        },
    } as never,
    new JwtService(),
    { refreshToken: { create: jest.fn() } } as never,
)

const build = (
    user: { status: string; sessionVersion: number } | null = {
        status: 'ACTIVE',
        sessionVersion: 0,
    },
) => {
    const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(user) },
        workspace: { findMany: jest.fn().mockResolvedValue([{ id: 'w1' }]) },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue([{ workspaceId: 'w2' }]),
        },
    }
    const gateway = new RealtimeGateway(tokens, prisma as never, {} as never)
    return { gateway, prisma }
}

const socket = (token: string) => ({
    handshake: { auth: { token }, headers: {}, query: {} },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    data: {} as Record<string, unknown>,
})

const accessToken = (sessionVersion = 0) =>
    tokens.generateToken({ userId: 'u1', sessionVersion })

describe('RealtimeGateway.handleConnection', () => {
    it('joins the user and workspace rooms for a current access token', async () => {
        const { gateway } = build()
        const client = socket(await accessToken())
        await gateway.handleConnection(client as never)
        expect(client.disconnect).not.toHaveBeenCalled()
        expect(client.join).toHaveBeenCalledTimes(3)
        expect(client.data.userId).toBe('u1')
    })

    it('refuses a refresh token', async () => {
        const { gateway, prisma } = build()
        const client = socket(
            await tokens.generateStoredToken({ userId: 'u1' }),
        )
        await gateway.handleConnection(client as never)
        expect(client.disconnect).toHaveBeenCalled()
        expect(client.join).not.toHaveBeenCalled()
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('refuses a token from before the sessions were ended', async () => {
        const { gateway } = build({ status: 'ACTIVE', sessionVersion: 1 })
        const client = socket(await accessToken(0))
        await gateway.handleConnection(client as never)
        expect(client.disconnect).toHaveBeenCalled()
        expect(client.join).not.toHaveBeenCalled()
    })

    it.each(['BLOCKED', 'DELETED'])('refuses a %s user', async (status) => {
        const { gateway } = build({ status, sessionVersion: 0 })
        const client = socket(await accessToken())
        await gateway.handleConnection(client as never)
        expect(client.disconnect).toHaveBeenCalled()
        expect(client.join).not.toHaveBeenCalled()
    })

    it('refuses a token for a user that no longer exists', async () => {
        const { gateway } = build(null)
        const client = socket(await accessToken())
        await gateway.handleConnection(client as never)
        expect(client.disconnect).toHaveBeenCalled()
    })
})
