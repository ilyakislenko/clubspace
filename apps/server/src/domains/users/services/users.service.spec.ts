import { compare } from 'bcrypt'

jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    UserStatus: {},
    LanguageEnum: {},
}))
jest.mock('../../../environments/environment', () => ({
    environment: { completeCodeTimeout: 60_000 },
}))

import {
    UserCompleteCodeTooEarlyError,
    UserNotFoundError,
} from '../errors/users.errors'
import { UsersService } from './users.service'

const build = (user: unknown) => {
    const prisma = {
        user: {
            findUnique: jest.fn().mockResolvedValue(user),
            update: jest.fn().mockResolvedValue({}),
        },
    }
    const events = { send: jest.fn().mockResolvedValue(undefined) }
    const service = new UsersService(prisma as never, events as never)
    return { service, prisma, events }
}

describe('UsersService.createCompleteCode', () => {
    it('throws when the user does not exist', async () => {
        const { service } = build(null)
        await expect(
            service.createCompleteCode({ userId: 'nope' }),
        ).rejects.toBeInstanceOf(UserNotFoundError)
    })

    it('enforces the resend cooldown', async () => {
        const { service, prisma } = build({
            id: 'u1',
            email: 'a@b.com',
            completeCode: 'old',
            completeCodeNextResendAt: new Date(Date.now() + 30_000),
        })
        await expect(
            service.createCompleteCode({ userId: 'u1' }),
        ).rejects.toBeInstanceOf(UserCompleteCodeTooEarlyError)
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('issues a hashed 6-digit code, sets the cooldown, and clears lockout state', async () => {
        const { service, prisma, events } = build({
            id: 'u1',
            email: 'a@b.com',
            completeCode: null,
            completeCodeNextResendAt: null,
        })
        const before = Date.now()
        await service.createCompleteCode({ userId: 'u1', timeout: 60_000 })

        const data = prisma.user.update.mock.calls[0][0].data
        // Stored value is a bcrypt hash, never the raw code.
        expect(data.completeCode).toMatch(/^\$2[aby]\$/)
        expect(data.signInFailedAttempts).toBe(0)
        expect(data.signInLockedUntil).toBeNull()
        expect(new Date(data.completeCodeNextResendAt).getTime()).toBeGreaterThan(
            before,
        )

        // The emitted plaintext code is a 6-digit string that matches the hash.
        const emitted = events.send.mock.calls[0][0].data.completeCode
        expect(emitted).toMatch(/^\d{6}$/)
        await expect(compare(emitted, data.completeCode)).resolves.toBe(true)
    })

    it('allows a resend once the cooldown has passed', async () => {
        const { service, prisma } = build({
            id: 'u1',
            email: 'a@b.com',
            completeCode: 'old',
            completeCodeNextResendAt: new Date(Date.now() - 1000),
        })
        await service.createCompleteCode({ userId: 'u1' })
        expect(prisma.user.update).toHaveBeenCalled()
    })
})
