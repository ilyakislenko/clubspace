import { SetLeaderboardVisibilityFeature } from './set-leaderboard-visibility.feature'
import { SetLeaderboardVisibilityHandler } from './set-leaderboard-visibility.handler'

const run = async (count: number, hidden = true) => {
    const prisma = {
        workspaceMember: { updateMany: jest.fn().mockResolvedValue({ count }) },
    }
    const cache = { invalidate: jest.fn().mockResolvedValue(undefined) }
    const out = await new SetLeaderboardVisibilityHandler(
        prisma as never,
        cache as never,
    ).execute(new SetLeaderboardVisibilityFeature('w1', 'u1', hidden))
    return { out, prisma, cache }
}

describe('setLeaderboardVisibility', () => {
    it('hides a member and drops the cached board so it takes effect at once', async () => {
        const { out, prisma, cache } = await run(1)
        expect(out).toEqual({ hidden: true })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
            data: { hideFromLeaderboard: true },
        })
        expect(cache.invalidate).toHaveBeenCalledWith('w1')
    })

    it('is a no-op for the owner, who has no member row', async () => {
        const { out, cache } = await run(0)
        expect(out).toEqual({ hidden: false })
        expect(cache.invalidate).not.toHaveBeenCalled()
    })
})
