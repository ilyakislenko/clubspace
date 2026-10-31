import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    AcceptMyConsentFeature,
    AcceptMyConsentFeatureResponse,
} from './accept-my-consent.feature'
import { consentStatusSelect, serializeMyConsent } from './schemas'

// Column widths of ConsentRecord.ip / userAgent.
const IP_MAX = 64
const USER_AGENT_MAX = 512

@Feature(AcceptMyConsentFeature)
export class AcceptMyConsentHandler
    implements
        IFeatureHandler<AcceptMyConsentFeature, AcceptMyConsentFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        userId,
        ip,
        userAgent,
    }: AcceptMyConsentFeature): Promise<AcceptMyConsentFeatureResponse> {
        const currentVersion = environment.consent.personalDataVersion

        // Consent counts only for the text the person actually saw. A client
        // holding an older edition (the text changed while the screen was
        // open) must reload it rather than silently accept the new one.
        if (payload.version !== currentVersion) {
            throw new ConflictError({
                message:
                    'Текст согласия обновился. Откройте его заново и подтвердите.',
            })
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: consentStatusSelect('PERSONAL_DATA'),
        })
        if (!user) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }

        // A double tap or a second device: the edition is already on record.
        if (user.personalDataConsentVersion === currentVersion) {
            return serializeMyConsent(user, currentVersion)
        }

        // Evidence first, then the flag AuthGuard reads. No transaction on
        // purpose: if the second write fails the user simply accepts again,
        // and an extra acceptance record is harmless; the reverse order could
        // open the gate with nothing on record.
        const record = await this.prisma.consentRecord.create({
            data: {
                userId,
                kind: 'PERSONAL_DATA',
                version: currentVersion,
                ip: ip ? ip.slice(0, IP_MAX) : null,
                userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
            },
            select: { version: true, acceptedAt: true },
        })
        await this.prisma.user.update({
            where: { id: userId },
            data: { personalDataConsentVersion: currentVersion },
            select: { id: true },
        })

        return serializeMyConsent(
            {
                personalDataConsentVersion: currentVersion,
                consentRecords: [record],
            },
            currentVersion,
        )
    }
}
