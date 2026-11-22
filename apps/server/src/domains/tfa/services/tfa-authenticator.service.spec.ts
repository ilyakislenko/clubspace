// otplib is ESM-only: `verify` is a stub that accepts CODE in time step STEP
// (as the real one would within its tolerance window).
jest.mock('otplib', () => ({ verify: jest.fn() }))
jest.mock('../../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { verify } from 'otplib'
import { encrypt } from '../../../shared/utils/encryption.util'
import { TfaAuthenticatorService } from './tfa-authenticator.service'

const KEY = 'test-encryption-key'
const CODE = '123456'
const STEP = 59_000_000

type Row = {
    id: string
    userId: string
    type: 'GOOGLE'
    enabled: boolean
    secret: string
    lastUsedTimeStep: number | null
}

// A one-row table honouring the where clauses the service uses.
const build = (row: Partial<Row> = {}) => {
    const state: Row = {
        id: 'method-1',
        userId: 'admin-1',
        type: 'GOOGLE',
        enabled: true,
        secret: encrypt('PLAINSECRET', KEY),
        lastUsedTimeStep: null,
        ...row,
    }
    const prisma = {
        tfaMethod: {
            findFirst: jest.fn(
                async ({ where }: { where: { userId: string; enabled: boolean } }) =>
                    where.userId === state.userId && where.enabled === state.enabled
                        ? { ...state }
                        : null,
            ),
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: string; secret: string }
                    data: { lastUsedTimeStep: number }
                }) => {
                    const stepFree =
                        state.lastUsedTimeStep === null ||
                        state.lastUsedTimeStep < data.lastUsedTimeStep
                    if (where.id !== state.id || where.secret !== state.secret || !stepFree) {
                        return { count: 0 }
                    }
                    state.lastUsedTimeStep = data.lastUsedTimeStep
                    return { count: 1 }
                },
            ),
        },
    }
    const service = new TfaAuthenticatorService(
        prisma as never,
        { encryptionKey: KEY } as never,
    )
    return { service, prisma, state }
}

describe('TfaAuthenticatorService.verifyCode', () => {
    beforeEach(() => {
        ;(verify as jest.Mock).mockReset()
        ;(verify as jest.Mock).mockImplementation(async ({ token }: { token: string }) =>
            token === CODE
                ? { valid: true, delta: 0, epoch: 0, timeStep: STEP }
                : { valid: false },
        )
    })

    it('returns the matched method and records its time step', async () => {
        const { service, state } = build()
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.toEqual({ methodId: 'method-1', secret: state.secret })
        expect(verify).toHaveBeenCalledWith(
            expect.objectContaining({ token: CODE, secret: 'PLAINSECRET' }),
        )
        expect(state.lastUsedTimeStep).toBe(STEP)
    })

    // RFC 6238 §5.2: an accepted OTP must not be accepted again.
    it('rejects the same code a second time', async () => {
        const { service } = build()
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.not.toBeNull()
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.toBeNull()
    })

    it('rejects a code from a step at or before the last accepted one', async () => {
        const { service, prisma } = build({ lastUsedTimeStep: STEP })
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.toBeNull()
        expect(prisma.tfaMethod.updateMany).not.toHaveBeenCalled()
    })

    it('accepts a code from a later step', async () => {
        const { service, state } = build({ lastUsedTimeStep: STEP - 1 })
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.not.toBeNull()
        expect(state.lastUsedTimeStep).toBe(STEP)
    })

    // Two sign-ins racing with one code both pass the read; only the
    // conditional write decides, so one of them loses.
    it('lets only one of two concurrent uses of a code through', async () => {
        const { service, prisma } = build()
        const results = await Promise.all([
            service.verifyCode({ userId: 'admin-1', code: CODE }),
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ])
        expect(results.filter((r) => r !== null)).toHaveLength(1)
        expect(prisma.tfaMethod.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'method-1',
                secret: expect.any(String),
                OR: [
                    { lastUsedTimeStep: null },
                    { lastUsedTimeStep: { lt: STEP } },
                ],
            },
            data: { lastUsedTimeStep: STEP },
        })
    })

    it('rejects a wrong code without recording anything', async () => {
        const { service, prisma } = build()
        await expect(
            service.verifyCode({ userId: 'admin-1', code: '000000' }),
        ).resolves.toBeNull()
        expect(prisma.tfaMethod.updateMany).not.toHaveBeenCalled()
    })

    it('checks the pending method only when asked to', async () => {
        const { service } = build({ enabled: false })
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE }),
        ).resolves.toBeNull()
        await expect(
            service.verifyCode({ userId: 'admin-1', code: CODE, pending: true }),
        ).resolves.toMatchObject({ methodId: 'method-1' })
    })
})
