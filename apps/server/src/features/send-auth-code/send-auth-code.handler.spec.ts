// environment.ts reads required env vars at import; stub it so loading the
// handler under test doesn't need the full CI env.
jest.mock('../../environments/environment', () => ({
    environment: {
        rootUrl: 'http://localhost:3000',
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))

import { environment } from '../../environments/environment'
import { SendAuthCodeHandler } from './send-auth-code.handler'

const prismaErr = (code: string) =>
    Object.assign(new Error(`prisma ${code}`), { code })

const build = (createImpl: () => Promise<unknown>) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'w1', name: 'Club', ownerId: 'owner' }),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(createImpl),
        },
        role: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
    }
    const featuresBus = { execute: jest.fn().mockResolvedValue(undefined) }
    const handler = new SendAuthCodeHandler(
        {} as never,
        prisma as never,
        featuresBus as never,
        { assertCanSend: jest.fn().mockResolvedValue(undefined) } as never,
    )
    return { handler, prisma, featuresBus }
}

// ensureInvitedMembership is private — exercise it directly; it's the unit the
// concurrency fix lives in.
const ensure = (handler: SendAuthCodeHandler) =>
    (
        handler as unknown as {
            ensureInvitedMembership: (p: {
                userId: string
                userEmail: string
                workspaceKey: string
            }) => Promise<void>
        }
    ).ensureInvitedMembership({
        userId: 'u1',
        userEmail: 'a@b.com',
        workspaceKey: 'club',
    })

describe('SendAuthCodeHandler.ensureInvitedMembership', () => {
    it('swallows a P2002 from a concurrent invite (no 500, no double-notify)', async () => {
        const { handler, featuresBus } = build(() =>
            Promise.reject(prismaErr('P2002')),
        )
        await expect(ensure(handler)).resolves.toBeUndefined()
        expect(featuresBus.execute).not.toHaveBeenCalled()
    })

    it('rethrows a non-P2002 error', async () => {
        const { handler } = build(() => Promise.reject(prismaErr('P9999')))
        await expect(ensure(handler)).rejects.toThrow('P9999')
    })

    it('notifies the owner on a successful first invite', async () => {
        const { handler, featuresBus } = build(() =>
            Promise.resolve({ id: 'm1' }),
        )
        await ensure(handler)
        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
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
            { execute: jest.fn() } as never,
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
    const buildReview = () => {
        const users = {
            getUserByEmail: jest.fn(),
            createUser: jest.fn(),
            createCompleteCode: jest.fn(),
        }
        const prisma = {
            workspace: { findUnique: jest.fn() },
            workspaceMember: { create: jest.fn() },
        }
        const featuresBus = { execute: jest.fn() }
        const mailHealth = { assertCanSend: jest.fn() }
        const handler = new SendAuthCodeHandler(
            users as never,
            prisma as never,
            featuresBus as never,
            mailHealth as never,
        )
        return { handler, users, prisma, featuresBus, mailHealth }
    }

    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('sends nothing and creates nothing for the review email', async () => {
        environment.storeReview = { email: 'review@b.com', code: '482916' }
        const { handler, users, prisma, featuresBus, mailHealth } =
            buildReview()
        const result = await handler.execute({
            payload: { email: ' Review@B.com ', workspaceKey: 'club' },
        } as never)
        expect(result).toEqual({ new: false })
        expect(mailHealth.assertCanSend).not.toHaveBeenCalled()
        expect(users.getUserByEmail).not.toHaveBeenCalled()
        expect(users.createUser).not.toHaveBeenCalled()
        expect(users.createCompleteCode).not.toHaveBeenCalled()
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(featuresBus.execute).not.toHaveBeenCalled()
    })

    it('runs the normal flow when unconfigured', async () => {
        const { handler, users, mailHealth } = buildReview()
        users.getUserByEmail.mockResolvedValue({ id: 'u1' })
        const result = await handler.execute({
            payload: { email: 'review@b.com' },
        } as never)
        expect(result).toEqual({ new: false })
        expect(mailHealth.assertCanSend).toHaveBeenCalled()
        expect(users.createCompleteCode).toHaveBeenCalledWith({ userId: 'u1' })
    })
})
