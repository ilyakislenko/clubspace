import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetMyConsentFeature,
    GetMyConsentFeatureResponse,
} from './get-my-consent.feature'
import { consentStatusSelect, serializeMyConsent } from './schemas'

@Feature(GetMyConsentFeature)
export class GetMyConsentHandler
    implements IFeatureHandler<GetMyConsentFeature, GetMyConsentFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
    }: GetMyConsentFeature): Promise<GetMyConsentFeatureResponse> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: consentStatusSelect('PERSONAL_DATA'),
        })
        if (!user) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }
        return serializeMyConsent(
            user,
            environment.consent.personalDataVersion,
        )
    }
}
