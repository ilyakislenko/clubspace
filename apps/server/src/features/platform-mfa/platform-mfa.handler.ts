import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import {
    TfaAlreadyEnabledError,
    TfaCodeInvalidError,
    TfaEnrollmentNotStartedError,
} from '../../domains/tfa/errors/tfa.errors'
import { TfaAuthenticatorService } from '../../domains/tfa/services/tfa-authenticator.service'
import { TfaService } from '../../domains/tfa/services/tfa.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    ConfirmPlatformMfaEnrollmentFeature,
    ConfirmPlatformMfaEnrollmentFeatureResponse,
    GetPlatformMfaFeature,
    GetPlatformMfaFeatureResponse,
    StartPlatformMfaEnrollmentFeature,
    StartPlatformMfaEnrollmentFeatureResponse,
} from './platform-mfa.feature'
import { buildTotpEnrollment } from './totp-uri'

const PLATFORM_ONLY = 'Раздел только для администраторов платформы'

@Feature(GetPlatformMfaFeature)
export class GetPlatformMfaHandler
    implements IFeatureHandler<GetPlatformMfaFeature, GetPlatformMfaFeatureResponse>
{
    constructor(private readonly tfaAuthenticator: TfaAuthenticatorService) {}

    async execute({ caller }: GetPlatformMfaFeature) {
        assertPlatformAdmin(caller.platformAccount, PLATFORM_ONLY)
        return {
            enrolled: await this.tfaAuthenticator.isEnabled(caller.invokerUserId),
            required: environment.platformAdminMfaRequired,
            accessGranted: caller.accessGranted,
        }
    }
}

// A new secret each time, replacing one not yet confirmed. Refused once an
// authenticator is confirmed: swapping it from a session would hand the second
// factor to whoever holds that session.
@Feature(StartPlatformMfaEnrollmentFeature)
export class StartPlatformMfaEnrollmentHandler
    implements
        IFeatureHandler<
            StartPlatformMfaEnrollmentFeature,
            StartPlatformMfaEnrollmentFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly tfa: TfaService,
        private readonly tfaAuthenticator: TfaAuthenticatorService,
    ) {}

    async execute({ caller }: StartPlatformMfaEnrollmentFeature) {
        assertPlatformAdmin(caller.platformAccount, PLATFORM_ONLY)
        const userId = caller.invokerUserId
        if (await this.tfaAuthenticator.isEnabled(userId)) {
            throw new TfaAlreadyEnabledError()
        }

        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { email: true },
        })
        const { secret } = await this.tfa.createTfaMethod({
            userId,
            type: 'GOOGLE',
        })
        const { otpauthUrl, qrPngDataUrl } = await buildTotpEnrollment({
            secret,
            account: user.email ?? userId,
        })
        return { secret, otpauthUrl, qrPngDataUrl }
    }
}

// The first code from the app proves it holds the secret; only then does
// sign-in start asking for it. The session itself is not upgraded: the
// platform opens after the next sign-in with both codes.
@Feature(ConfirmPlatformMfaEnrollmentFeature)
export class ConfirmPlatformMfaEnrollmentHandler
    implements
        IFeatureHandler<
            ConfirmPlatformMfaEnrollmentFeature,
            ConfirmPlatformMfaEnrollmentFeatureResponse
        >
{
    constructor(
        private readonly tfa: TfaService,
        private readonly tfaAuthenticator: TfaAuthenticatorService,
        private readonly audit: AuditService,
    ) {}

    async execute({ payload, caller }: ConfirmPlatformMfaEnrollmentFeature) {
        assertPlatformAdmin(caller.platformAccount, PLATFORM_ONLY)
        const userId = caller.invokerUserId
        if (await this.tfaAuthenticator.isEnabled(userId)) {
            throw new TfaAlreadyEnabledError()
        }

        const valid = await this.tfaAuthenticator.verifyCode({
            userId,
            code: payload.code,
            pending: true,
        })
        if (!valid) {
            throw new TfaCodeInvalidError()
        }
        if (!(await this.tfa.confirmPendingTfaMethod({ userId, type: 'GOOGLE' }))) {
            throw new TfaEnrollmentNotStartedError()
        }

        await this.audit.record({
            action: 'auth.mfaEnrolled',
            targetType: 'member',
            targetId: userId,
            actorId: userId,
            workspaceId: null,
        })
        return { enrolled: true as const }
    }
}
