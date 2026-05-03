import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    RegisterFirebaseDeviceFeature,
    RegisterFirebaseDeviceFeatureResponse,
} from './register-firebase-device.feature'

@Feature(RegisterFirebaseDeviceFeature)
export class RegisterFirebaseDeviceHandler
    implements
        IFeatureHandler<
            RegisterFirebaseDeviceFeature,
            RegisterFirebaseDeviceFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, payload }: RegisterFirebaseDeviceFeature) {
        await this.prisma.firebaseDevice.upsert({
            where: { userId_token: { userId, token: payload.token } },
            create: {
                userId,
                token: payload.token,
                timezone: payload.timezone,
            },
            update: { timezone: payload.timezone },
        })
        return { status: 'registered' as const }
    }
}
