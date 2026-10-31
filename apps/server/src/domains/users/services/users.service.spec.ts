import { compare } from 'bcrypt'

jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    UserStatus: { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED', DELETED: 'DELETED' },
    LanguageEnum: {},
    Prisma: { DbNull: 'DbNull' },
}))
jest.mock('../../../environments/environment', () => ({
    environment: {
        completeCodeTimeout: 60_000,
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))

import { environment } from '../../../environments/environment'
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
        dropInBooking: del(),
        rankGradingCandidate: del(),
        trainingJournalEntry: del(),
        personalTrainingCoach: del(),
        attendanceSession: del(),
        personalTrainingRequest: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        auditEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        rankPromotion: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        subscriptionFreezeRequest: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        memberRetentionContact: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
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
        expect(tx.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        // Only open grading slots go; PASSED/FAILED stay as history.
        expect(tx.rankGradingCandidate.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', result: 'PENDING' },
        })

        // Personal training: offer removed, requests closed, comments scrubbed,
        // unattended personal sessions deleted.
        expect(tx.personalTrainingCoach.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.attendanceSession.deleteMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                isPersonal: true,
                records: { none: {} },
            }),
        })
        const updates = tx.personalTrainingRequest.updateMany.mock.calls.map(
            (c: any[]) => c[0],
        )
        expect(updates.map((u: any) => u.data)).toEqual([
            { status: 'CANCELLED', closedByRole: 'member' },
            { status: 'CANCELLED', closedByRole: 'coach' },
            { memberComment: null, coachComment: null, closeComment: null },
        ])

        // Audit trail kept, but member-targeted metadata (email/names) is nulled.
        expect(tx.auditEvent.updateMany).toHaveBeenCalledWith({
            where: { targetType: 'member', targetId: 'u1' },
            data: { metadata: 'DbNull' },
        })
        expect(tx.rankPromotion.updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
            data: { note: null },
        })
        // Staff notes about the member are purged; notes the user wrote as
        // staff lose their text.
        expect(tx.memberRetentionContact.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.memberRetentionContact.updateMany).toHaveBeenCalledWith({
            where: { contactedById: 'u1' },
            data: { note: null },
        })
        // Their freeze requests go; the comments they wrote as staff are wiped.
        expect(tx.subscriptionFreezeRequest.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(tx.subscriptionFreezeRequest.updateMany).toHaveBeenCalledWith({
            where: { decidedById: 'u1' },
            data: { decisionComment: null },
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
        // Every outstanding access token dies with the account.
        expect(data.sessionVersion).toEqual({ increment: 1 })
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

describe('UsersService.createCompleteCode — store review account', () => {
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('never issues or mails a code for the review email', async () => {
        environment.storeReview = { email: 'review@b.com', code: '730419' }
        const { service, prisma, events } = build({
            id: 'u1',
            email: 'Review@B.com',
            completeCode: null,
            completeCodeNextResendAt: null,
        })
        await service.createCompleteCode({ userId: 'u1' })
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(events.send).not.toHaveBeenCalled()
    })
})

describe('UsersService e-mail lookup', () => {
    const buildLookup = (row: unknown = null) => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue(row),
                findMany: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn().mockImplementation(({ data }) =>
                    Promise.resolve({ id: 'u-new', email: data.email }),
                ),
            },
        }
        const events = { send: jest.fn().mockResolvedValue(undefined) }
        return {
            service: new UsersService(prisma as never, events as never),
            prisma,
        }
    }

    it('looks up by the exact trimmed, lowercased address', async () => {
        const { service, prisma } = buildLookup({ id: 'u1' })
        const found = await service.getUserByEmail({ email: ' Ivan@Mail.ru ' })
        expect(found).toEqual({ id: 'u1' })
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { email: 'ivan@mail.ru' },
        })
    })

    it('treats _ and % literally: no pattern query is ever issued', async () => {
        const { service, prisma } = buildLookup(null)
        expect(await service.getUserByEmail({ email: 'ivan_petrov@mail.ru' })).toBeNull()
        expect(await service.getUserByEmail({ email: '%@%.%' })).toBeNull()
        expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
            where: { email: 'ivan_petrov@mail.ru' },
        })
        expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
            where: { email: '%@%.%' },
        })
        expect(prisma.user.findMany).not.toHaveBeenCalled()
        expect(prisma.user.findFirst).not.toHaveBeenCalled()
    })

    it('creates new users with a lowercased e-mail', async () => {
        const { service, prisma } = buildLookup()
        await service.createUser({ email: 'Ivan@Mail.ru' })
        expect(prisma.user.create.mock.calls[0][0].data.email).toBe('ivan@mail.ru')
    })
})
