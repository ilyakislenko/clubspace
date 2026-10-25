import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { UpdateMemberProfileFeature } from './update-member-profile.feature'
import { UpdateMemberProfileHandler } from './update-member-profile.handler'

const makePrisma = (over: {
    membership?: { id: string } | null
    ownerId?: string | null
    targetSuperAdmin?: boolean
    ownsOther?: boolean
    memberOfOther?: boolean
    phoneOwnerId?: string | null
    targetPhone?: string | null
} = {}) => {
    const tx = {
        user: {
            update: jest.fn().mockResolvedValue({
                id: 'u1',
                email: 'new@x.io',
                firstname: 'Иван',
                lastname: 'Иванов',
                phone: null,
            }),
        },
        refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    }
    return {
        tx,
        workspaceMember: {
            findFirst: jest.fn().mockImplementation(({ where }) =>
                Promise.resolve(
                    where.workspaceId?.not
                        ? over.memberOfOther
                            ? { id: 'other' }
                            : null
                        : over.membership === undefined
                          ? { id: 'm1' }
                          : over.membership,
                ),
            ),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: over.ownerId ?? 'someone-else' }),
            findFirst: jest
                .fn()
                .mockResolvedValue(over.ownsOther ? { id: 'w2' } : null),
        },
        user: {
            findUnique: jest.fn().mockImplementation(({ where }) =>
                Promise.resolve(
                    where.phone
                        ? over.phoneOwnerId
                            ? { id: over.phoneOwnerId }
                            : null
                        : where.id
                        ? {
                              email: 'old@x.io',
                              phone: over.targetPhone ?? null,
                              isSuperAdmin: over.targetSuperAdmin ?? false,
                          }
                        : null,
                ),
            ),
        },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    }
}

const makeAudit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const makeRealtime = () => ({ invalidate: jest.fn() })
const makeRbac = (admin = true) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({}),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const run = (
    prisma: any,
    payload: any = { firstname: 'Иван' },
    rbac: any = makeRbac(),
    invoker = 'admin1',
) =>
    new UpdateMemberProfileHandler(
        prisma as any,
        makeAudit() as any,
        makeRealtime() as any,
        rbac as any,
    ).execute(
        new UpdateMemberProfileFeature(
            payload,
            'w1',
            'u1',
            invoker,
            'admin',
            false,
        ),
    )

describe('UpdateMemberProfileHandler', () => {
    it('updates a normal member name without touching sessions', async () => {
        const prisma = makePrisma({ membership: { id: 'm1' } })
        const result = await run(prisma)
        expect(prisma.tx.user.update).toHaveBeenCalledTimes(1)
        expect(prisma.tx.refreshToken.deleteMany).not.toHaveBeenCalled()
        expect(result.firstname).toBe('Иван')
    })

    it('refuses a non-admin (coach) and changes nothing', async () => {
        const prisma = makePrisma()
        await expect(
            run(prisma, { email: 'new@x.io' }, makeRbac(false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('changes a plain member e-mail and revokes their sessions', async () => {
        const prisma = makePrisma()
        const result = await run(prisma, { email: 'new@x.io' })
        expect(prisma.tx.user.update.mock.calls[0][0].data).toEqual({
            email: 'new@x.io',
        })
        expect(prisma.tx.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1' },
        })
        expect(result.email).toBe('new@x.io')
    })

    it('refuses an e-mail change for the workspace owner', async () => {
        const prisma = makePrisma({ membership: null, ownerId: 'u1' })
        await expect(
            run(prisma, { email: 'new@x.io' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses an e-mail change for a super admin', async () => {
        const prisma = makePrisma({ targetSuperAdmin: true })
        await expect(
            run(prisma, { email: 'new@x.io' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses an e-mail change for the invoker themself', async () => {
        const prisma = makePrisma()
        await expect(
            run(prisma, { email: 'new@x.io' }, makeRbac(), 'u1'),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses an e-mail change for a user who belongs to another club', async () => {
        const prisma = makePrisma({ memberOfOther: true })
        await expect(
            run(prisma, { email: 'new@x.io' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses an e-mail change for a user who owns another club', async () => {
        const prisma = makePrisma({ ownsOther: true })
        await expect(
            run(prisma, { email: 'new@x.io' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('still lets an admin rename the owner and a multi-club user', async () => {
        const prisma = makePrisma({
            membership: null,
            ownerId: 'u1',
            memberOfOther: true,
        })
        const result = await run(prisma)
        expect(prisma.tx.user.update).toHaveBeenCalledTimes(1)
        expect(prisma.tx.refreshToken.deleteMany).not.toHaveBeenCalled()
        expect(result.lastname).toBe('Иванов')
    })

    it('rejects a user who is neither a member nor the owner', async () => {
        const prisma = makePrisma({ membership: null, ownerId: 'someone-else' })
        await expect(run(prisma)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.tx.user.update).not.toHaveBeenCalled()
    })

    it('stores a normalised phone', async () => {
        const prisma = makePrisma()
        await run(prisma, { phone: '+7 (900) 000-00-00' })
        expect(prisma.tx.user.update.mock.calls[0][0].data).toEqual({
            phone: '+79000000000',
        })
        expect(prisma.tx.refreshToken.deleteMany).not.toHaveBeenCalled()
    })

    it('clears the phone on an empty string', async () => {
        const prisma = makePrisma()
        await run(prisma, { phone: '' })
        expect(prisma.tx.user.update.mock.calls[0][0].data).toEqual({
            phone: null,
        })
    })

    it('rejects a phone that is too short', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, { phone: '123' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects a phone that belongs to another user', async () => {
        const prisma = makePrisma({ phoneOwnerId: 'other-user' })
        await expect(
            run(prisma, { phone: '+79000000000' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('stores a Russian 8-prefixed number in the canonical +7 form', async () => {
        const prisma = makePrisma()
        await run(prisma, { phone: '8 (900) 000-00-00' })
        expect(prisma.tx.user.update.mock.calls[0][0].data).toEqual({
            phone: '+79000000000',
        })
    })

    it('names the phone when the unique-constraint race is on the phone', async () => {
        const prisma = makePrisma()
        prisma.$transaction.mockRejectedValueOnce({
            code: 'P2002',
            meta: { target: ['phone'] },
        })
        await expect(
            run(prisma, { phone: '+79000000000' }),
        ).rejects.toMatchObject({
            message: 'Этот телефон уже указан у другого пользователя',
        })
    })

    it('names the e-mail when the unique-constraint race is on the e-mail', async () => {
        const prisma = makePrisma()
        prisma.$transaction.mockRejectedValueOnce({
            code: 'P2002',
            meta: { target: ['email'] },
        })
        await expect(run(prisma, { email: 'new@x.io' })).rejects.toMatchObject({
            message: 'Этот email уже занят другим пользователем',
        })
    })

    it.each([
        ['owns this club', { membership: null, ownerId: 'u1' }],
        ['is a super admin', { targetSuperAdmin: true }],
        ['belongs to another club', { memberOfOther: true }],
        ['owns another club', { ownsOther: true }],
    ])('refuses a phone change for a user who %s', async (_n, over) => {
        const prisma = makePrisma(over)
        await expect(
            run(prisma, { phone: '+79000000000' }),
        ).rejects.toMatchObject({
            message: 'Телефон этого пользователя нельзя изменить из клуба',
        })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a phone change for the invoker themself', async () => {
        const prisma = makePrisma()
        await expect(
            run(prisma, { phone: '+79000000000' }, makeRbac(), 'u1'),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lets a multi-club user keep the same phone (no change)', async () => {
        const prisma = makePrisma({
            memberOfOther: true,
            targetPhone: '+79000000000',
        })
        await run(prisma, { phone: '8 900 000 00 00' })
        expect(prisma.tx.user.update).toHaveBeenCalledTimes(1)
    })
})
