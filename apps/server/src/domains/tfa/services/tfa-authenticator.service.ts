import { Inject, Injectable } from '@nestjs/common'
import { verify } from 'otplib'
import { PrismaService } from '../../../infrastructure/prisma'
import { decrypt } from '../../../shared/utils/encryption.util'
import type { TfaConfig } from '../configs/tfa-module.config'
import { TFA_CONFIG } from '../configs/tfa-module.config'

// One time step either way, for a phone clock that drifts a little.
const EPOCH_TOLERANCE_SECONDS = 30

@Injectable()
export class TfaAuthenticatorService {
    constructor(
        private readonly prisma: PrismaService,
        @Inject(TFA_CONFIG) private readonly config: TfaConfig,
    ) {}

    // A confirmed authenticator; one still being set up does not count.
    async isEnabled(userId: string): Promise<boolean> {
        const count = await this.prisma.tfaMethod.count({
            where: { userId, type: 'GOOGLE', enabled: true },
        })
        return count > 0
    }

    // Against the confirmed authenticator, or with `pending` against the one
    // being set up. False when there is none.
    async verifyCode(payload: {
        userId: string
        code: string
        pending?: boolean
    }): Promise<boolean> {
        const tfaMethod = await this.prisma.tfaMethod.findFirst({
            where: {
                userId: payload.userId,
                type: 'GOOGLE',
                enabled: !payload.pending,
            },
            select: { secret: true },
        })
        if (!tfaMethod) return false

        const decodedSecret = decrypt(
            tfaMethod.secret,
            this.config.encryptionKey,
        )

        const result = await verify({
            token: payload.code,
            secret: decodedSecret,
            epochTolerance: EPOCH_TOLERANCE_SECONDS,
        })

        return result.valid
    }
}
