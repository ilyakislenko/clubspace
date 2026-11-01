import { NotFoundError } from '../../shared/errors/shared.errors'
import { UpdateMembershipNotificationsFeature } from './update-membership-notifications.feature'
import { UpdateMembershipNotificationsHandler } from './update-membership-notifications.handler'

const build = (count: number) => {
    const updateMany = jest.fn().mockResolvedValue({ count })
    const handler = new UpdateMembershipNotificationsHandler({
        workspaceMember: { updateMany },
    } as never)
    return { handler, updateMany }
}

describe('updateMembershipNotifications', () => {
    it.each([true, false])('sets muted=%s on the caller\'s own active row', async (muted) => {
        const { handler, updateMany } = build(1)
        await expect(
            handler.execute(
                new UpdateMembershipNotificationsFeature({ muted }, 'w1', 'u1'),
            ),
        ).resolves.toEqual({ workspaceId: 'w1', notificationsMuted: muted })
        expect(updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1', workspaceId: 'w1', status: 'ACTIVE' },
            data: { notificationsMuted: muted },
        })
    })

    it('404s when the caller has no active membership there', async () => {
        const { handler } = build(0)
        await expect(
            handler.execute(
                new UpdateMembershipNotificationsFeature({ muted: true }, 'w1', 'u1'),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
