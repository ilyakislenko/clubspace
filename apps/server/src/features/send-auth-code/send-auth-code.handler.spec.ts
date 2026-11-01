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

const build = () => {
    const prisma = {
        pendingSignIn: {
            upsert: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    }
    const users = {
        getUserByEmail: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
        createUser: jest.fn(),
        createCompleteCode: jest.fn().mockResolvedValue(undefined),
        createPendingSignInCode: jest.fn().mockResolvedValue(undefined),
    }
    const handler = new SendAuthCodeHandler(
        users as never,
        prisma as never,
        { assertCanSend: jest.fn().mockResolvedValue(undefined) } as never,
    )
    return { handler, prisma, users }
}

const send = (
    handler: SendAuthCodeHandler,
    workspaceKey?: string,
    flag: { requestJoin?: boolean } = {},
) =>
    handler.execute({
        payload: { email: 'a@b.com', workspaceKey, ...flag },
    } as never)

describe('SendAuthCodeHandler.execute — unknown address', () => {
    it('creates no account, only a pending code', async () => {
        const { handler, users } = build()
        users.getUserByEmail.mockResolvedValue(null)
        await expect(send(handler)).resolves.toEqual({ sent: true })
        expect(users.createUser).not.toHaveBeenCalled()
        expect(users.createCompleteCode).not.toHaveBeenCalled()
        expect(users.createPendingSignInCode).toHaveBeenCalledWith({
            email: 'a@b.com',
            language: undefined,
            joinWorkspaceKey: null,
        })
    })

    it('answers exactly like an existing account', async () => {
        const existing = build()
        const fresh = build()
        fresh.users.getUserByEmail.mockResolvedValue(null)
        expect(await send(fresh.handler)).toEqual(await send(existing.handler))
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

// The join request itself is filed by sign-in once the address is proven;
// here only what is remembered for it.
describe('SendAuthCodeHandler.execute — requestJoin flag', () => {
    it('remembers the club for a new address when the flag is omitted', async () => {
        const { handler, users } = build()
        users.getUserByEmail.mockResolvedValue(null)
        await send(handler, 'club')
        expect(users.createPendingSignInCode).toHaveBeenCalledWith(
            expect.objectContaining({ joinWorkspaceKey: 'club' }),
        )
    })

    it('remembers nothing for a new address when the flag is false', async () => {
        const { handler, users } = build()
        users.getUserByEmail.mockResolvedValue(null)
        await send(handler, 'club', { requestJoin: false })
        expect(users.createPendingSignInCode).toHaveBeenCalledWith(
            expect.objectContaining({ joinWorkspaceKey: null }),
        )
    })

    it('clears any club for an existing account when the flag is omitted', async () => {
        const { handler, prisma } = build()
        await send(handler, 'club')
        expect(prisma.pendingSignIn.upsert).not.toHaveBeenCalled()
        expect(prisma.pendingSignIn.updateMany).toHaveBeenCalledWith({
            where: { email: 'a@b.com' },
            data: { joinWorkspaceKey: null },
        })
    })

    it('remembers the club for an existing account that explicitly asks', async () => {
        const { handler, prisma } = build()
        await send(handler, 'club', { requestJoin: true })
        expect(prisma.pendingSignIn.upsert).toHaveBeenCalledWith({
            where: { email: 'a@b.com' },
            create: { email: 'a@b.com', joinWorkspaceKey: 'club' },
            update: { joinWorkspaceKey: 'club' },
        })
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
            pendingSignIn: {
                upsert: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        }
        const mailHealth = { assertCanSend: jest.fn() }
        const handler = new SendAuthCodeHandler(
            users as never,
            prisma as never,
            mailHealth as never,
        )
        return { handler, users, prisma, mailHealth }
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
        const { handler, users, prisma, mailHealth } = buildReview()
        const result = await runReview(handler)
        expect(result).toEqual({ sent: true })
        expect(mailHealth.assertCanSend).toHaveBeenCalled()
        expect(users.createUser).not.toHaveBeenCalled()
        expect(users.createCompleteCode).not.toHaveBeenCalled()
        expect(prisma.pendingSignIn.upsert).not.toHaveBeenCalled()
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

    describe('demo accounts', () => {
        const demoUser = { id: 'u-demo', email: 'coach@arsenal.demo', completeCodeNextResendAt: null }
        const runDemo = (handler: SendAuthCodeHandler) =>
            handler.execute({ payload: { email: 'coach@arsenal.demo' } } as never)
        afterEach(() => {
            environment.demo = { enabled: false }
        })

        it('stamps instead of mailing while demo mode is on', async () => {
            environment.storeReview = { email: undefined, code: undefined }
            environment.demo = { enabled: true, workspaceKey: 'arsenal-demo', code: '730592' }
            const { handler, users, prisma } = buildReview(demoUser)
            await expect(runDemo(handler)).resolves.toEqual({ sent: true })
            expect(users.createCompleteCode).not.toHaveBeenCalled()
            expect(prisma.user.update.mock.calls[0][0].where).toEqual({ id: 'u-demo' })
        })

        it('mails a normal code when demo mode is off', async () => {
            environment.storeReview = { email: undefined, code: undefined }
            environment.demo = { enabled: false }
            const { handler, users, prisma } = buildReview(demoUser)
            await runDemo(handler)
            expect(users.createCompleteCode).toHaveBeenCalledWith({ userId: 'u-demo' })
            expect(prisma.user.update).not.toHaveBeenCalled()
        })
    })
})
