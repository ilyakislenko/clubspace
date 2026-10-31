import { captureException } from '../../app/sentry'
import { CheckInFollowUpService } from './check-in-follow-up.service'

jest.mock('../../app/sentry', () => ({ captureException: jest.fn() }))

const build = () => {
    const classPacks = {
        notifyLowOrExhausted: jest.fn().mockResolvedValue(undefined),
    }
    const achievements = { notifyUnlocked: jest.fn().mockResolvedValue(undefined) }
    const service = new CheckInFollowUpService(
        classPacks as never,
        achievements as never,
    )
    return { service, classPacks, achievements }
}

beforeEach(() => (captureException as jest.Mock).mockClear())

describe('CheckInFollowUpService', () => {
    it('runs the pack alert and the achievement check for the batch', async () => {
        const { service, classPacks, achievements } = build()
        service.schedule({
            workspaceId: 'w1',
            userIds: ['u1', 'u2'],
            subscriptionIds: ['s1'],
        })
        await service.drain()
        expect(classPacks.notifyLowOrExhausted).toHaveBeenCalledWith(
            ['s1'],
            'w1',
        )
        expect(achievements.notifyUnlocked).toHaveBeenCalledWith(
            ['u1', 'u2'],
            'w1',
        )
    })

    it('returns before the follow-up work finishes', () => {
        const { service, achievements } = build()
        achievements.notifyUnlocked.mockReturnValue(new Promise(() => undefined))
        expect(
            service.schedule({
                workspaceId: 'w1',
                userIds: ['u1'],
                subscriptionIds: [],
            }),
        ).toBeUndefined()
    })

    it('reports a failure and still runs the next step', async () => {
        const { service, classPacks, achievements } = build()
        const boom = new Error('push down')
        classPacks.notifyLowOrExhausted.mockRejectedValue(boom)
        service.schedule({
            workspaceId: 'w1',
            userIds: ['u1'],
            subscriptionIds: ['s1'],
        })
        await service.drain()
        expect(captureException).toHaveBeenCalledWith(boom)
        expect(achievements.notifyUnlocked).toHaveBeenCalled()
    })

    it('skips an empty job', async () => {
        const { service, classPacks, achievements } = build()
        service.schedule({ workspaceId: 'w1', userIds: [], subscriptionIds: [] })
        await service.onModuleDestroy()
        expect(classPacks.notifyLowOrExhausted).not.toHaveBeenCalled()
        expect(achievements.notifyUnlocked).not.toHaveBeenCalled()
    })
})
