// environment.ts reads required env vars at import; stub it so loading the
// handler under test doesn't need the full CI env.
jest.mock('../../environments/environment', () => ({
    environment: {
        rootUrl: 'http://localhost:3000',
        adminEmail: 'admin@super.com',
        completeCodeTimeout: 60_000,
        storeReview: { email: undefined, code: undefined },
    },
}))

import { UserCompleteCodeTooEarlyError } from '../../domains/users/errors/users.errors'
import { environment } from '../../environments/environment'
import { SendAuthCodeHandler } from './send-auth-code.handler'

const build = (joinImpl: () => Promise<unknown> = async () => ({ kind: 'created' })) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'w1',
                name: 'Club',
                ownerId: 'owner',
                isActive: true,
            }),
        },
    }
    const users = {
        getUserByEmail: jest.fn().mockResolvedValue({ id: 'u1' }),
        createUser: jest.fn(),
        createCompleteCode: jest.fn().mockResolvedValue(undefined),
    }
    const joinRequests = {
        requestMembership: jest.fn().mockImplementation(joinImpl),
    }
    const handler = new SendAuthCodeHandler(
        users as never,
        prisma as never,
        { assertCanSend: jest.fn().mockResolvedValue(undefined) } as never,
        joinRequests as never,
    )
    return { handler, prisma, users, joinRequests }
}

// requestJoin defaults to the explicit opt-in so the club-key cases below test
// the request itself; the flag's own branches are covered separately.
const send = (
    handler: SendAuthCodeHandler,
    workspaceKey?: string,
    flag: { requestJoin?: boolean } = { requestJoin: true },
) =>
    handler.execute({
        payload: { email: 'a@b.com', workspaceKey, ...flag },
    } as never)

describe('SendAuthCodeHandler.execute — club key', () => {
    it('files a join request that always needs approval', async () => {
        const { handler, prisma, joinRequests } = build()
        await send(handler, 'club')
        expect(prisma.workspace.findUnique.mock.calls[0][0].where).toEqual({
            key: 'club',
        })
        expect(joinRequests.requestMembership).toHaveBeenCalledWith({
            userId: 'u1',
            workspace: expect.objectContaining({ id: 'w1', ownerId: 'owner' }),
            autoApprove: false,
            audience: 'owner',
        })
    })

    it('does nothing without a club key', async () => {
        const { handler, prisma, joinRequests } = build()
        await expect(send(handler)).resolves.toEqual({ sent: true })
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('stays silent about an unknown key', async () => {
        const { handler, prisma, joinRequests } = build()
        prisma.workspace.findUnique.mockResolvedValue(null)
        await expect(send(handler, 'nope')).resolves.toEqual({ sent: true })
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('does not file a request for an inactive club', async () => {
        const { handler, prisma, joinRequests } = build()
        prisma.workspace.findUnique.mockResolvedValue({
            id: 'w1',
            name: 'Club',
            ownerId: 'owner',
            isActive: false,
        })
        await expect(send(handler, 'club')).resolves.toEqual({ sent: true })
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('never fails the sign-up when the join request fails', async () => {
        const { handler, users } = build(() => Promise.reject(new Error('boom')))
        await expect(send(handler, 'club')).resolves.toEqual({ sent: true })
        expect(users.createCompleteCode).toHaveBeenCalledWith({ userId: 'u1' })
    })

    it('never fails the sign-up when the club lookup fails', async () => {
        const { handler, prisma } = build()
        prisma.workspace.findUnique.mockRejectedValue(new Error('db'))
        await expect(send(handler, 'club')).resolves.toEqual({ sent: true })
    })
})

describe('SendAuthCodeHandler.execute — account enumeration', () => {
    it('answers a new address exactly like an existing account', async () => {
        const existing = build()
        const fresh = build()
        fresh.users.getUserByEmail.mockResolvedValue(null)
        fresh.users.createUser.mockResolvedValue({ id: 'u-new' })

        const forExisting = await send(existing.handler)
        const forNew = await send(fresh.handler)

        expect(forNew).toEqual(forExisting)
        expect(existing.users.createUser).not.toHaveBeenCalled()
        expect(fresh.users.createUser).toHaveBeenCalledWith({
            email: 'a@b.com',
            language: undefined,
        })
        expect(fresh.users.createCompleteCode).toHaveBeenCalledWith({
            userId: 'u-new',
        })
    })

    it('surfaces the resend cooldown without naming the account', async () => {
        const { handler, users } = build()
        users.createCompleteCode.mockRejectedValue(
            new UserCompleteCodeTooEarlyError(),
        )
        const error = await send(handler).catch((e: unknown) => e)
        if (!(error instanceof UserCompleteCodeTooEarlyError)) {
            throw new Error('expected the cooldown error')
        }
        expect(error.metadata).toEqual({})
        expect(error.message).not.toContain('u1')
    })
})

describe('SendAuthCodeHandler.execute — requestJoin flag', () => {
    it('files nothing for an existing account when the flag is omitted', async () => {
        const { handler, prisma, joinRequests } = build()
        await send(handler, 'club', {})
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('files the request for a brand-new account when the flag is omitted', async () => {
        const { handler, users, joinRequests } = build()
        users.getUserByEmail.mockResolvedValue(null)
        users.createUser.mockResolvedValue({ id: 'new-user' })
        await send(handler, 'club', {})
        expect(joinRequests.requestMembership).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'new-user' }),
        )
    })

    it('never files the request when the flag is false, even for a new account', async () => {
        const { handler, users, prisma, joinRequests } = build()
        users.getUserByEmail.mockResolvedValue(null)
        users.createUser.mockResolvedValue({ id: 'new-user' })
        await send(handler, 'club', { requestJoin: false })
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('files the request for an existing account that explicitly asks', async () => {
        const { handler, joinRequests } = build()
        await send(handler, 'club', { requestJoin: true })
        expect(joinRequests.requestMembership).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'u1' }),
        )
    })
})

describe('SendAuthCodeHandler.execute — mail outage', () => {
    it('refuses with the mail error before creating a user or a code', async () => {
        const users = {
            getUserByEmail: jest.fn(),
            createUser: jest.fn(),
            createCompleteCode: jest.fn(),
        }
        const mailHealth = {
            assertCanSend: jest
                .fn()
                .mockRejectedValue(new Error('почта временно не работает')),
        }
        const handler = new SendAuthCodeHandler(
            users as never,
            {} as never,
            mailHealth as never,
            { requestMembership: jest.fn() } as never,
        )
        await expect(
            handler.execute({
                payload: { email: 'a@b.com', workspaceKey: 'club' },
            } as never),
        ).rejects.toThrow('почта временно не работает')
        expect(users.getUserByEmail).not.toHaveBeenCalled()
        expect(users.createUser).not.toHaveBeenCalled()
        expect(users.createCompleteCode).not.toHaveBeenCalled()
    })
})

describe('SendAuthCodeHandler.execute — store review account', () => {
    const buildReview = (user: unknown = { id: 'u1', email: 'review@b.com', completeCodeNextResendAt: null }) => {
        const users = {
            getUserByEmail: jest.fn().mockResolvedValue(user),
            createUser: jest.fn(),
            createCompleteCode: jest.fn(),
        }
        const prisma = {
            user: { update: jest.fn().mockResolvedValue({}) },
            workspace: { findUnique: jest.fn() },
        }
        const joinRequests = { requestMembership: jest.fn() }
        const mailHealth = { assertCanSend: jest.fn() }
        const handler = new SendAuthCodeHandler(
            users as never,
            prisma as never,
            mailHealth as never,
            joinRequests as never,
        )
        return { handler, users, prisma, joinRequests, mailHealth }
    }
    const runReview = (handler: SendAuthCodeHandler) =>
        handler.execute({
            payload: { email: ' Review@B.com ', workspaceKey: 'club' },
        } as never)

    beforeEach(() => {
        environment.storeReview = { email: 'review@b.com', code: '730419' }
    })
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('mails nothing and creates nothing, but stamps the request', async () => {
        const { handler, users, prisma, joinRequests, mailHealth } =
            buildReview()
        const result = await runReview(handler)
        expect(result).toEqual({ sent: true })
        expect(mailHealth.assertCanSend).toHaveBeenCalled()
        expect(users.createUser).not.toHaveBeenCalled()
        expect(users.createCompleteCode).not.toHaveBeenCalled()
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
        const data = prisma.user.update.mock.calls[0][0].data
        expect(data.completeCodeIssuedAt).toBeInstanceOf(Date)
        expect(data.completeCodeNextResendAt.getTime()).toBeGreaterThan(
            Date.now(),
        )
        expect(data).not.toHaveProperty('completeCode')
    })

    it('refuses a too-early repeat like a normal account', async () => {
        const { handler, prisma } = buildReview({
            id: 'u1',
            email: 'review@b.com',
            completeCodeNextResendAt: new Date(Date.now() + 30_000),
        })
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            UserCompleteCodeTooEarlyError,
        )
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('does not create a missing review user', async () => {
        const { handler, users, prisma } = buildReview(null)
        await expect(runReview(handler)).resolves.toEqual({ sent: true })
        expect(users.createUser).not.toHaveBeenCalled()
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('runs the normal flow when unconfigured', async () => {
        environment.storeReview = { email: undefined, code: undefined }
        const { handler, users, mailHealth } = buildReview()
        const result = await runReview(handler)
        expect(result).toEqual({ sent: true })
        expect(mailHealth.assertCanSend).toHaveBeenCalled()
        expect(users.createCompleteCode).toHaveBeenCalledWith({ userId: 'u1' })
    })
})
