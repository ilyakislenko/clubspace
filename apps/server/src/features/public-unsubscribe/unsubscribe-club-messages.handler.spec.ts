jest.mock('../../environments/environment', () => ({
    environment: { encryptionKey: 'unit-secret' },
}))

import {
    clubMessagesUnsubscribeUrl,
    signUnsubscribeToken,
    verifyUnsubscribeToken,
} from '../../domains/messages/unsubscribe-token'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { UnsubscribeClubMessagesFeature } from './unsubscribe-club-messages.feature'
import {
    INVALID_UNSUBSCRIBE_LINK,
    UnsubscribeClubMessagesHandler,
} from './unsubscribe-club-messages.handler'

const USER = '0b6f1f0e-1d6a-4f3c-9a51-2f7d8e4c1a10'

describe('unsubscribe token', () => {
    it('round-trips for the secret that signed it', () => {
        expect(verifyUnsubscribeToken(signUnsubscribeToken(USER, 's1'), 's1')).toBe(USER)
    })

    it('is refused under another secret, tampered, or malformed', () => {
        const token = signUnsubscribeToken(USER, 's1')
        const [, mac] = token.split('.')
        const other = '1b6f1f0e-1d6a-4f3c-9a51-2f7d8e4c1a10'
        for (const bad of [
            token.replace(USER, other),
            `${USER}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`,
            `${USER}.${mac}.x`,
            `not-a-uuid.${mac}`,
            `${USER}.short`,
            '',
        ]) {
            expect(verifyUnsubscribeToken(bad, 's1')).toBeNull()
        }
        expect(verifyUnsubscribeToken(token, 's2')).toBeNull()
    })

    it('builds the public link under the API root', () => {
        expect(clubMessagesUnsubscribeUrl('https://api.example/', USER, 's1')).toBe(
            `https://api.example/public/unsubscribe/club-messages?token=${signUnsubscribeToken(USER, 's1')}`,
        )
    })
})

describe('UnsubscribeClubMessagesHandler', () => {
    const make = (user: unknown = { id: USER }) => {
        const prisma = {
            user: { findUnique: jest.fn().mockResolvedValue(user) },
            notificationPreferences: { upsert: jest.fn().mockResolvedValue({}) },
        }
        // apply = the POST (confirm button or one-click); false = opening the link.
        const run = (token: string, apply = true) =>
            new UnsubscribeClubMessagesHandler(prisma as never).execute(
                new UnsubscribeClubMessagesFeature({ token }, apply),
            )
        return { prisma, run }
    }

    it('opening the link only checks it: mail scanners open every link', async () => {
        const { prisma, run } = make()
        expect(await run(signUnsubscribeToken(USER, 'unit-secret'), false)).toEqual({ unsubscribed: false })
        expect(prisma.notificationPreferences.upsert).not.toHaveBeenCalled()
        await expect(run(signUnsubscribeToken(USER, 'another-secret'), false)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('the POST turns off the e-mail copies only, keeping every other preference', async () => {
        const { prisma, run } = make()
        expect(await run(signUnsubscribeToken(USER, 'unit-secret'))).toEqual({ unsubscribed: true })
        expect(prisma.notificationPreferences.upsert).toHaveBeenCalledWith({
            where: { userId: USER },
            update: { clubMessagesEmailEnabled: false },
            create: {
                userId: USER,
                emailEnabled: false,
                pushEnabled: false,
                telegramEnabled: false,
                clubMessagesEmailEnabled: false,
            },
        })
    })

    it('refuses a link this server did not issue without touching the database', async () => {
        const { prisma, run } = make()
        await expect(run(signUnsubscribeToken(USER, 'another-secret'))).rejects.toThrow(INVALID_UNSUBSCRIBE_LINK)
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
        expect(prisma.notificationPreferences.upsert).not.toHaveBeenCalled()
    })

    it('refuses the link of a deleted account', async () => {
        const { prisma, run } = make(null)
        await expect(run(signUnsubscribeToken(USER, 'unit-secret'))).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.notificationPreferences.upsert).not.toHaveBeenCalled()
    })
})
