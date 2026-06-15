// environment.ts reads required env vars at import; stub it so loading the
// handler under test doesn't need the full CI env.
jest.mock('../../environments/environment', () => ({
    environment: { rootUrl: 'http://localhost:3000' },
}))

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
