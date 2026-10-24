import { compare } from 'bcrypt'

jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    UserStatus: { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED', DELETED: 'DELETED' },
    LanguageEnum: {},
}))
jest.mock('../../../environments/environment', () => ({
    environment: { completeCodeTimeout: 60_000 },
}))

import { BadRequestError } from '../../../shared/errors/shared.errors'
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

    it('issues a hashed 6-digit code, sets the cooldown, and leaves lockout state untouched', async () => {
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
        // Must NOT touch the brute-force lockout — otherwise re-requesting a
        // code would clear an active sign-in lock (the sign-in handler owns it).
        expect(data).not.toHaveProperty('signInFailedAttempts')
        expect(data).not.toHaveProperty('signInLockedUntil')
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

const buildDelete = (o: { owned?: number; coached?: number }) => {
    const del = () => ({ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) })
    const tx = {
        refreshToken: del(),
        tfaMethod: del(),
        firebaseDevice: del(),
        notification: del(),
        notificationPreferences: del(),
        videoFavorite: del(),
        videoWatched: del(),
        file: del(),
        workspaceMember: del(),
        groupMember: del(),
        groupCoach: del(),
        trainingJournalEntry: del(),
        auditEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        user: { update: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        workspace: { count: jest.fn().mockResolvedValue(o.owned ?? 0) },
        group: { count: jest.fn().mockResolvedValue(o.coached ?? 0) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
    }
    const events = { send: jest.fn() }
    const service = new UsersService(prisma as never, events as never)
    return { service, prisma, tx }
}

describe('UsersService.deleteAccount (soft-delete / anonymize)', () => {
    it('anonymizes the user, purges personal data, and keeps the row', async () => {
        const { service, tx } = buildDelete({})
        await service.deleteAccount('u1')

        // Personal data + sessions purged.
        expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.workspaceMember.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.videoWatched.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.trainingJournalEntry.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })

        // Audit trail kept, but the real email is scrubbed.
        expect(tx.auditEvent.updateMany).toHaveBeenCalledWith({
            where: { actorId: 'u1' },
            data: { actorEmail: null },
        })

        // Row kept but anonymized — never deleted.
        expect((tx.user as any).delete).toBeUndefined()
        expect(tx.user.update).toHaveBeenCalledTimes(1)
        const data = tx.user.update.mock.calls[0][0].data
        expect(data.status).toBe('DELETED')
        expect(data.email).toBe('deleted+u1@deleted.invalid')
        expect(data.firstname).toBeNull()
        expect(data.password).toBeNull()
        expect(data.deletedAt).toBeInstanceOf(Date)
    })

    it('refuses a workspace owner (never runs the transaction)', async () => {
        const { service, prisma, tx } = buildDelete({ owned: 1 })
        await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(tx.user.update).not.toHaveBeenCalled()
    })

    it('refuses a group coach', async () => {
        const { service } = buildDelete({ coached: 2 })
        await expect(service.deleteAccount('u1')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })
})
