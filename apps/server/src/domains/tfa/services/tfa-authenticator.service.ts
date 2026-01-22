import { Inject, Injectable } from '@nestjs/common'
import { verify } from 'otplib'
import { PrismaService } from '../../../infrastructure/prisma'
import { decrypt } from '../../../shared/utils/encryption.util'
import type { TfaConfig } from '../configs/tfa-module.config'
import { TFA_CONFIG } from '../configs/tfa-module.config'

@Injectable()
export class TfaAuthenticatorService {
    constructor(
        private readonly prisma: PrismaService,
        @Inject(TFA_CONFIG) private readonly config: TfaConfig,
    ) {}

    async verifyCode(payload: { userId: string; code: string }) {
        const tfaMethod = await this.prisma.tfaMethod.findFirstOrThrow({
            where: { userId: payload.userId },
            select: {
                secret: true,
            },
        })

        const decodedSecret = decrypt(
            tfaMethod.secret,
            this.config.encryptionKey,
        )

        const result = await verify({
            token: payload.code,
            secret: decodedSecret,
        })

        return result.valid
    }
}
