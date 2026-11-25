import { Feature, IFeatureHandler } from '@shelfjs/features'

import { verifyUnsubscribeToken } from '../../domains/messages/unsubscribe-token'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    UnsubscribeClubMessagesFeature,
    type UnsubscribeClubMessagesFeatureResponse,
} from './unsubscribe-club-messages.feature'

export const INVALID_UNSUBSCRIBE_LINK = 'Ссылка для отписки недействительна'

// No login: the signed link turns off the e-mail copies of club messages for
// that person (every club — the switch is per account, like the app's
// «Сообщения клуба на e-mail»). Opening the link only checks it; the write is
// the POST (the page's button or the mail client's one-click). Idempotent.
@Feature(UnsubscribeClubMessagesFeature)
export class UnsubscribeClubMessagesHandler
    implements IFeatureHandler<UnsubscribeClubMessagesFeature, UnsubscribeClubMessagesFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: UnsubscribeClubMessagesFeature): Promise<UnsubscribeClubMessagesFeatureResponse> {
        const userId = verifyUnsubscribeToken(f.payload.token, environment.encryptionKey)
        const user = userId
            ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
            : null
        if (!user) throw new BadRequestError({ message: INVALID_UNSUBSCRIBE_LINK })
        if (!f.apply) return { unsubscribed: false }
        await this.prisma.notificationPreferences.upsert({
            where: { userId: user.id },
            update: { clubMessagesEmailEnabled: false },
            // The defaults NotificationsPreferencesService.getPreferences writes.
            create: {
                userId: user.id,
                emailEnabled: false,
                pushEnabled: false,
                telegramEnabled: false,
                clubMessagesEmailEnabled: false,
            },
        })
        return { unsubscribed: true }
    }
}
