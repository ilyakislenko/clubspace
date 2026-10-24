import { UsersEventPattern } from '../../domains/users/configs/users-events.config'
import { SendNotificationListener } from './send-notification.listener'

describe('SendNotificationListener', () => {
    it('puts the sign-in code in the email subject', async () => {
        let handler: (e: { data: unknown }) => Promise<void> = jest.fn()
        const usersEvents = {
            listen: jest.fn((pattern: string, cb: typeof handler) => {
                if (pattern === UsersEventPattern.USER_COMPLETE_CODE_CREATED) {
                    handler = cb
                }
            }),
        }
        const featuresBus = { execute: jest.fn().mockResolvedValue(undefined) }
        const listener = new SendNotificationListener(
            usersEvents as never,
            featuresBus as never,
        )

        await listener.onApplicationBootstrap()
        await handler({ data: { userId: 'u1', completeCode: '123456' } })

        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
        const feature = featuresBus.execute.mock.calls[0][0]
        expect(feature.payload).toMatchObject({
            userId: 'u1',
            topic: 'Код для входа: 123456',
            message: { htmlTemplateKey: 'code', data: { code: '123456' } },
        })
    })
})
