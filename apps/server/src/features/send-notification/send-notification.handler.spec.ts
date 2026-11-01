import { SendNotificationFeature } from './send-notification.feature'
import { SendNotificationHandler } from './send-notification.handler'

type Person = { id: string; email: string | null }

const build = (people: Person[], links: { dependentId: string; guardianId: string }[]) => {
    const users = {
        getUserById: jest.fn(async ({ id }: { id: string }) => {
            const person = people.find((p) => p.id === id)
            if (!person) throw new Error(`unknown user ${id}`)
            return person
        }),
    }
    const preferences = {
        getPreferences: jest
            .fn()
            .mockResolvedValue({ emailEnabled: true, pushEnabled: true }),
    }
    const notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) }
    const templates = { getTemplate: jest.fn() }
    const prisma = {
        guardianship: {
            findMany: jest.fn().mockResolvedValue(
                links.map((l) => ({ ...l, dependent: { firstname: 'Миша' } })),
            ),
        },
    }
    const handler = new SendNotificationHandler(
        users as never,
        preferences as never,
        notifications as never,
        templates as never,
        prisma as never,
    )
    return { handler, notifications, prisma }
}

const send = (userId: string) =>
    new SendNotificationFeature({
        userId,
        topic: 'Абонемент заканчивается',
        message: 'Осталось 2 занятия',
        types: ['EMAIL', 'PUSH'],
        metadata: { kind: 'subscription.expiring' },
    })

describe('SendNotificationHandler', () => {
    it('sends to the user itself by e-mail and push', async () => {
        const { handler, notifications, prisma } = build(
            [{ id: 'u1', email: 'u1@x.io' }],
            [],
        )
        await expect(handler.execute(send('u1'))).resolves.toEqual({
            success: true,
        })
        expect(prisma.guardianship.findMany).not.toHaveBeenCalled()
        expect(
            notifications.sendNotification.mock.calls.map((c) => [
                c[0].type,
                c[0].identity,
            ]),
        ).toEqual([
            ['EMAIL', 'u1@x.io'],
            ['PUSH', 'u1'],
        ])
    })

    it("delivers a dependent's notice to each guardian, named after the child", async () => {
        const { handler, notifications } = build(
            [
                { id: 'kid', email: null },
                { id: 'mom', email: 'mom@x.io' },
                { id: 'dad', email: 'dad@x.io' },
            ],
            [
                { dependentId: 'kid', guardianId: 'mom' },
                { dependentId: 'kid', guardianId: 'dad' },
            ],
        )
        await expect(handler.execute(send('kid'))).resolves.toEqual({
            success: true,
        })
        const calls = notifications.sendNotification.mock.calls.map((c) => c[0])
        // Guardians are served concurrently: compare as a set.
        expect(calls.map((c) => [c.userId, c.type, c.identity]).sort()).toEqual([
            ['dad', 'EMAIL', 'dad@x.io'],
            ['dad', 'PUSH', 'dad'],
            ['mom', 'EMAIL', 'mom@x.io'],
            ['mom', 'PUSH', 'mom'],
        ])
        expect(calls[0].topic).toBe('Миша: Абонемент заканчивается')
        expect(calls[0].metadata).toEqual({
            kind: 'subscription.expiring',
            dependentId: 'kid',
        })
    })

    it('sends nothing for a dependent without a confirmed guardian', async () => {
        const { handler, notifications } = build([{ id: 'kid', email: null }], [])
        await expect(handler.execute(send('kid'))).resolves.toEqual({
            success: true,
        })
        expect(notifications.sendNotification).not.toHaveBeenCalled()
    })
})
