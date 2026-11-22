import { createHash } from 'crypto'
import { hash } from 'bcrypt'

// Mock the modules that transitively import the ESM-only generated prisma
// client; the handler receives plain stubs below.
jest.mock('../../environments/environment', () => ({
    environment: {
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))
jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))
jest.mock('../../domains/audit/services/audit.service', () => ({
    AuditService: class {},
}))

import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { environment } from '../../environments/environment'
import {
    InvalidCredentialsError,
    TooManySignInAttemptsError,
} from '../sign-in/sign-in.feature'
import {
    DeleteAccountFeature,
    DeleteAccountFeatureInputSchema,
} from './delete-account.feature'
import { DeleteAccountHandler } from './delete-account.handler'

const CODE = '123456'
const IP = '10.0.0.1'
let codeHash: string

beforeAll(async () => {
    codeHash = await hash(CODE, 10)
})

const account = (o: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'a@b.com',
    completeCode: codeHash,
    completeCodeIssuedAt: new Date(),
    signInFailedAttempts: 0,
    signInLockedUntil: null,
    ...o,
})

const build = (user: unknown) => {
    const calls: string[] = []
    const prisma = {
        user: {
            findUnique: jest.fn().mockResolvedValue(user),
            update: jest.fn(async () => {
                calls.push('consume')
                return {}
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        signInThrottle: {
            findUnique: jest.fn().mockResolvedValue(null),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    }
    const users = {
        assertDeletable: jest.fn(async () => {
            calls.push('assert')
            return ['user-1']
        }),
        deleteAccount: jest.fn(async () => {
            calls.push('delete')
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new DeleteAccountHandler(
        users as never,
        prisma as never,
        audit as never,
    )
    return { handler, prisma, users, calls }
}

const run = (handler: DeleteAccountHandler, code = CODE) =>
    handler.execute(new DeleteAccountFeature({ code }, 'user-1', IP))

describe('DeleteAccountHandler', () => {
    it('refuses a request without a code', () => {
        expect(DeleteAccountFeatureInputSchema.safeParse({}).success).toBe(false)
    })

    it('refuses when no code was requested, deleting nothing', async () => {
        const { handler, users, prisma } = build(account({ completeCode: null }))
        await expect(run(handler)).rejects.toBeInstanceOf(UserNoCompleteCodeError)
        expect(users.deleteAccount).not.toHaveBeenCalled()
        expect(prisma.signInThrottle.updateMany).not.toHaveBeenCalled()
    })

    it('refuses an owner/coach before the code is checked or burnt', async () => {
        const { handler, users, prisma } = build(account())
        users.assertDeletable.mockRejectedValueOnce(
            new BadRequestError({ message: 'Передайте эти роли' }),
        )
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        // Not counted as an attempt, and the right code stays usable.
        expect(prisma.signInThrottle.createMany).not.toHaveBeenCalled()
        expect(prisma.signInThrottle.updateMany).not.toHaveBeenCalled()
        expect(prisma.user.updateMany).not.toHaveBeenCalled()
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(users.deleteAccount).not.toHaveBeenCalled()
    })

    it('refuses a wrong code and counts it like a wrong sign-in code', async () => {
        const { handler, users, prisma } = build(account())
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const ipHash = createHash('sha256').update(IP).digest('hex')
        expect(prisma.signInThrottle.createMany).toHaveBeenCalledWith({
            data: [{ userId: 'user-1', ipHash }],
            skipDuplicates: true,
        })
        expect(prisma.signInThrottle.updateMany.mock.calls[0][0]).toMatchObject({
            where: { userId: 'user-1', ipHash },
            data: { failedAttempts: { increment: 1 } },
        })
        expect(prisma.user.updateMany.mock.calls[0][0].data).toEqual({
            signInFailedAttempts: { increment: 1 },
        })
        expect(users.deleteAccount).not.toHaveBeenCalled()
        // The code is not burnt by a wrong guess.
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('refuses while sign-in is locked, before checking the code', async () => {
        const { handler, users, prisma } = build(
            account({ signInLockedUntil: new Date(Date.now() + 60_000) }),
        )
        await expect(run(handler)).rejects.toBeInstanceOf(
            TooManySignInAttemptsError,
        )
        expect(prisma.signInThrottle.updateMany).not.toHaveBeenCalled()
        expect(users.deleteAccount).not.toHaveBeenCalled()
    })

    it('refuses an expired code', async () => {
        const { handler, users } = build(
            account({ completeCodeIssuedAt: new Date(Date.now() - 16 * 60_000) }),
        )
        await expect(run(handler)).rejects.toBeInstanceOf(InvalidCredentialsError)
        expect(users.deleteAccount).not.toHaveBeenCalled()
    })

    it('burns the right code, then deletes the account', async () => {
        const { handler, users, prisma, calls } = build(account())
        await expect(run(handler)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: expect.objectContaining({
                completeCode: null,
                completeCodeIssuedAt: null,
            }),
        })
        expect(users.deleteAccount).toHaveBeenCalledWith('user-1')
        expect(calls).toEqual(['assert', 'consume', 'delete'])
    })

    describe('store review account', () => {
        const REVIEW_CODE = '730419'
        beforeEach(() => {
            environment.storeReview = { email: 'a@b.com', code: REVIEW_CODE }
        })
        afterEach(() => {
            environment.storeReview = { email: undefined, code: undefined }
        })

        it('deletes with the fixed code once a code was requested', async () => {
            const { handler, users } = build(account({ completeCode: null }))
            await expect(run(handler, REVIEW_CODE)).resolves.toEqual({
                status: 'deleted',
            })
            expect(users.deleteAccount).toHaveBeenCalledWith('user-1')
        })

        it('refuses another code', async () => {
            const { handler, users } = build(account({ completeCode: null }))
            await expect(run(handler, CODE)).rejects.toBeInstanceOf(
                InvalidCredentialsError,
            )
            expect(users.deleteAccount).not.toHaveBeenCalled()
        })
    })
})
