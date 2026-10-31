import { SignOutEverywhereFeature } from './sign-out-everywhere.feature'
import { SignOutEverywhereHandler } from './sign-out-everywhere.handler'

const build = () => {
    const prisma = {
        user: { update: jest.fn().mockReturnValue('user-update') },
        refreshToken: {
            updateMany: jest.fn().mockReturnValue('refresh-revoke'),
        },
        $transaction: jest.fn().mockResolvedValue([]),
    }
    return { handler: new SignOutEverywhereHandler(prisma as never), prisma }
}

describe('SignOutEverywhereHandler', () => {
    it('bumps the session version and revokes every refresh token, atomically', async () => {
        const { handler, prisma } = build()

        const result = await handler.execute(new SignOutEverywhereFeature('u1'))

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: 'u1' },
            data: { sessionVersion: { increment: 1 } },
            select: { id: true },
        })
        // Revoked, not deleted: a later replay is still recognised as reuse.
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1', isRevoked: false },
            data: { isRevoked: true },
        })
        expect(prisma.$transaction).toHaveBeenCalledWith([
            'user-update',
            'refresh-revoke',
        ])
        expect(result).toEqual({ status: 'signed-out' })
    })

    it('only ever touches the caller', async () => {
        const { handler, prisma } = build()
        await handler.execute(new SignOutEverywhereFeature('u2'))
        expect(prisma.user.update.mock.calls[0][0].where).toEqual({ id: 'u2' })
        expect(prisma.refreshToken.updateMany.mock.calls[0][0].where.userId).toBe(
            'u2',
        )
    })
})
