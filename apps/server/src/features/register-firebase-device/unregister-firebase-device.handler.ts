import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    UnregisterFirebaseDeviceFeature,
    UnregisterFirebaseDeviceFeatureResponse,
} from './unregister-firebase-device.feature'

@Feature(UnregisterFirebaseDeviceFeature)
export class UnregisterFirebaseDeviceHandler
    implements
        IFeatureHandler<
            UnregisterFirebaseDeviceFeature,
            UnregisterFirebaseDeviceFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, token }: UnregisterFirebaseDeviceFeature) {
        await this.prisma.firebaseDevice
            .delete({
                where: { userId_token: { userId, token } },
            })
            .catch(() => {
                /* idempotent */
            })
        return { status: 'removed' as const }
    }
}
