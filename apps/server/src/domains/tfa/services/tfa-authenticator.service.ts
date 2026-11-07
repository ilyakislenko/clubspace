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
    // being set up. The method and the exact (stored) secret the code matched,
    // or null when there is none or the code is wrong.
    //
    // A code is accepted once: its time step must be later than the last
    // accepted one, and is recorded with a conditional write so two requests
    // racing with the same code can't both pass. (otplib's functional
    // `verify` drops `afterTimeStep`, so the step is compared here.)
    async verifyCode(payload: {
        userId: string
        code: string
        pending?: boolean
    }): Promise<TfaCodeMatch | null> {
        const tfaMethod = await this.prisma.tfaMethod.findFirst({
            where: {
                userId: payload.userId,
                type: 'GOOGLE',
                enabled: !payload.pending,
            },
            select: { id: true, secret: true, lastUsedTimeStep: true },
        })
        if (!tfaMethod) return null

        const decodedSecret = decrypt(
            tfaMethod.secret,
            this.config.encryptionKey,
        )

        const result = await verify({
            token: payload.code,
            secret: decodedSecret,
            epochTolerance: EPOCH_TOLERANCE_SECONDS,
        })
        if (!result.valid || !('timeStep' in result)) return null
        const { timeStep } = result
        if (
            tfaMethod.lastUsedTimeStep !== null &&
            timeStep <= tfaMethod.lastUsedTimeStep
        ) {
            return null
        }

        const { count } = await this.prisma.tfaMethod.updateMany({
            where: {
                id: tfaMethod.id,
                secret: tfaMethod.secret,
                OR: [
                    { lastUsedTimeStep: null },
                    { lastUsedTimeStep: { lt: timeStep } },
                ],
            },
            data: { lastUsedTimeStep: timeStep },
        })
        if (count === 0) return null

        return { methodId: tfaMethod.id, secret: tfaMethod.secret }
    }
}

// Identifies the exact secret a code was checked against: the row keeps its
// id when a restarted enrolment replaces the pending secret.
export interface TfaCodeMatch {
    methodId: string
    secret: string
}
