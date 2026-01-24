import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'

@Injectable()
export class FirebaseDevicesService {
    constructor(private readonly prisma: PrismaService) {}

    async registerFirebaseDevice(payload: {
        userId: string
        token: string
        timezone: string
    }) {
        const device = await this.prisma.firebaseDevice.upsert({
            where: {
                userId_token: {
                    userId: payload.userId,
                    token: payload.token,
                },
            },
            create: {
                userId: payload.userId,
                token: payload.token,
                timezone: payload.timezone,
            },
            update: {
                timezone: payload.timezone,
            },
        })

        return {
            id: device.id,
        }
    }
}
