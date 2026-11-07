// otplib is ESM-only; the generated prisma client is kept out.
jest.mock('otplib', () => ({ generateSecret: jest.fn(() => 'PLAINSECRET') }))
jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    Prisma: {
        PrismaClientKnownRequestError: jest.requireActual(
            '@prisma/client/runtime/client',
        ).PrismaClientKnownRequestError,
    },
}))

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client'
import { decrypt } from '../../../shared/utils/encryption.util'
import { TfaAlreadyEnabledError } from '../errors/tfa.errors'
import { TfaService } from './tfa.service'

const KEY = 'test-encryption-key'
const uniqueViolation = () =>
    new PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' })

const build = () => {
    const prisma = {
        tfaMethod: {
            upsert: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    const service = new TfaService({ encryptionKey: KEY } as never, prisma as never)
    return { service, prisma }
}

describe('TfaService.createTfaMethod', () => {
    // The one row per user and type is created, or its pending secret
    // replaced; a confirmed row never matches.
    it('upserts the pending row with a fresh encrypted secret', async () => {
        const { service, prisma } = build()
        await expect(
            service.createTfaMethod({ userId: 'admin-1', type: 'GOOGLE' }),
        ).resolves.toEqual({ secret: 'PLAINSECRET' })
        const args = prisma.tfaMethod.upsert.mock.calls[0][0]
        expect(args.where).toEqual({
            userId_type: { userId: 'admin-1', type: 'GOOGLE' },
            enabled: false,
        })
        expect(args.create).toMatchObject({
            userId: 'admin-1',
            type: 'GOOGLE',
            enabled: false,
        })
        expect(decrypt(args.create.secret, KEY)).toBe('PLAINSECRET')
        // A replaced secret starts with no accepted code.
        expect(args.update).toEqual({
            secret: args.create.secret,
            lastUsedTimeStep: null,
        })
    })

    // A concurrent start created the pending row between upsert's read and
    // its insert: this start replaces its secret.
    it('replaces the secret of a pending row created concurrently', async () => {
        const { service, prisma } = build()
        prisma.tfaMethod.upsert.mockRejectedValue(uniqueViolation())
        await service.createTfaMethod({ userId: 'admin-1', type: 'GOOGLE' })
        expect(prisma.tfaMethod.updateMany).toHaveBeenCalledWith({
            where: { userId: 'admin-1', type: 'GOOGLE', enabled: false },
            data: { secret: expect.any(String), lastUsedTimeStep: null },
        })
    })

    it('never replaces a confirmed authenticator', async () => {
        const { service, prisma } = build()
        prisma.tfaMethod.upsert.mockRejectedValue(uniqueViolation())
        prisma.tfaMethod.updateMany.mockResolvedValue({ count: 0 })
        await expect(
            service.createTfaMethod({ userId: 'admin-1', type: 'GOOGLE' }),
        ).rejects.toBeInstanceOf(TfaAlreadyEnabledError)
    })

    it('passes other database errors through', async () => {
        const { service, prisma } = build()
        const failure = new Error('connection lost')
        prisma.tfaMethod.upsert.mockRejectedValue(failure)
        await expect(
            service.createTfaMethod({ userId: 'admin-1', type: 'GOOGLE' }),
        ).rejects.toBe(failure)
        expect(prisma.tfaMethod.updateMany).not.toHaveBeenCalled()
    })
})

describe('TfaService.confirmPendingTfaMethod', () => {
    const match = { methodId: 'method-1', secret: 'encrypted-secret' }

    it('enables exactly the secret the code was checked against', async () => {
        const { service, prisma } = build()
        await expect(
            service.confirmPendingTfaMethod({ userId: 'admin-1', match }),
        ).resolves.toBe(true)
        expect(prisma.tfaMethod.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'method-1',
                userId: 'admin-1',
                secret: 'encrypted-secret',
                enabled: false,
            },
            data: { enabled: true },
        })
    })

    // Confirmed concurrently, or a restarted enrolment replaced the secret.
    it('reports false when that secret is no longer pending', async () => {
        const { service, prisma } = build()
        prisma.tfaMethod.updateMany.mockResolvedValue({ count: 0 })
        await expect(
            service.confirmPendingTfaMethod({ userId: 'admin-1', match }),
        ).resolves.toBe(false)
    })
})
