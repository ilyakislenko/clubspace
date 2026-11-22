// otplib / qrcode and the generated prisma client are kept out; the handlers
// get stubs.
jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/tfa/services/tfa-authenticator.service', () => ({
    TfaAuthenticatorService: class {},
}))
jest.mock('../../domains/tfa/services/tfa.service', () => ({
    TfaService: class {},
}))
jest.mock('../../domains/audit/services/audit.service', () => ({
    AuditService: class {},
}))
jest.mock('../../environments/environment', () => ({
    environment: { platformAdminMfaRequired: true },
}))
jest.mock('./totp-uri', () => ({
    buildTotpEnrollment: jest.fn().mockResolvedValue({
        otpauthUrl: 'otpauth://totp/ClubSpace:a%40b.com?secret=SECRET',
        qrPngDataUrl: 'data:image/png;base64,QR',
    }),
}))

import {
    TfaAlreadyEnabledError,
    TfaCodeInvalidError,
    TfaEnrollmentNotStartedError,
} from '../../domains/tfa/errors/tfa.errors'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import {
    ConfirmPlatformMfaEnrollmentFeature,
    GetPlatformMfaFeature,
    StartPlatformMfaEnrollmentFeature,
} from './platform-mfa.feature'
import {
    ConfirmPlatformMfaEnrollmentHandler,
    GetPlatformMfaHandler,
    StartPlatformMfaEnrollmentHandler,
} from './platform-mfa.handler'
import { buildTotpEnrollment } from './totp-uri'

// A super admin signed in by e-mail code alone: no powers yet, but this is
// the way to get them.
const pendingAdmin = {
    invokerUserId: 'admin-1',
    platformAccount: true,
    accessGranted: false,
}
const member = {
    invokerUserId: 'user-1',
    platformAccount: false,
    accessGranted: false,
}

const MATCH = { methodId: 'method-1', secret: 'encrypted-secret' }

const build = (o: { enrolled?: boolean; validPendingCode?: string } = {}) => {
    const prisma = {
        user: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'a@b.com' }),
        },
    }
    const tfa = {
        createTfaMethod: jest.fn().mockResolvedValue({ secret: 'SECRET' }),
        confirmPendingTfaMethod: jest.fn().mockResolvedValue(true),
    }
    const tfaAuthenticator = {
        isEnabled: jest.fn().mockResolvedValue(o.enrolled ?? false),
        verifyCode: jest.fn(
            async ({ code, pending }: { code: string; pending?: boolean }) =>
                pending === true && code === o.validPendingCode ? MATCH : null,
        ),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return {
        prisma,
        tfa,
        tfaAuthenticator,
        audit,
        get: new GetPlatformMfaHandler(tfaAuthenticator as never),
        start: new StartPlatformMfaEnrollmentHandler(
            prisma as never,
            tfa as never,
            tfaAuthenticator as never,
        ),
        confirm: new ConfirmPlatformMfaEnrollmentHandler(
            tfa as never,
            tfaAuthenticator as never,
            audit as never,
        ),
    }
}

describe('GetPlatformMfaHandler', () => {
    it('reports the state to a super admin without the powers', async () => {
        const { get } = build({ enrolled: true })
        await expect(
            get.execute(new GetPlatformMfaFeature(pendingAdmin)),
        ).resolves.toEqual({ enrolled: true, required: true, accessGranted: false })
    })

    it('refuses an account that is not a platform admin', async () => {
        const { get } = build()
        await expect(
            get.execute(new GetPlatformMfaFeature(member)),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('StartPlatformMfaEnrollmentHandler', () => {
    it('hands out a new secret with its QR code', async () => {
        const { start, tfa } = build()
        await expect(
            start.execute(new StartPlatformMfaEnrollmentFeature(pendingAdmin)),
        ).resolves.toEqual({
            secret: 'SECRET',
            otpauthUrl: 'otpauth://totp/ClubSpace:a%40b.com?secret=SECRET',
            qrPngDataUrl: 'data:image/png;base64,QR',
        })
        expect(tfa.createTfaMethod).toHaveBeenCalledWith({
            userId: 'admin-1',
            type: 'GOOGLE',
        })
        expect(buildTotpEnrollment).toHaveBeenCalledWith({
            secret: 'SECRET',
            account: 'a@b.com',
        })
    })

    // Swapping a confirmed authenticator from a session would hand the second
    // factor to whoever holds the session.
    it('refuses to replace a confirmed authenticator', async () => {
        const { start, tfa } = build({ enrolled: true })
        await expect(
            start.execute(new StartPlatformMfaEnrollmentFeature(pendingAdmin)),
        ).rejects.toBeInstanceOf(TfaAlreadyEnabledError)
        expect(tfa.createTfaMethod).not.toHaveBeenCalled()
    })

    it('refuses an account that is not a platform admin', async () => {
        const { start, tfa } = build()
        await expect(
            start.execute(new StartPlatformMfaEnrollmentFeature(member)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(tfa.createTfaMethod).not.toHaveBeenCalled()
    })
})

describe('ConfirmPlatformMfaEnrollmentHandler', () => {
    const confirmWith = (code: string, caller = pendingAdmin) =>
        new ConfirmPlatformMfaEnrollmentFeature({ code }, caller)

    it('turns the authenticator on with a code from it, and audits', async () => {
        const { confirm, tfa, audit } = build({ validPendingCode: '123456' })
        await expect(confirm.execute(confirmWith('123456'))).resolves.toEqual({
            enrolled: true,
        })
        // Exactly the secret the code was checked against.
        expect(tfa.confirmPendingTfaMethod).toHaveBeenCalledWith({
            userId: 'admin-1',
            match: MATCH,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.mfaEnrolled',
                targetId: 'admin-1',
                workspaceId: null,
            }),
        )
    })

    it('keeps it off on a wrong code', async () => {
        const { confirm, tfa } = build({ validPendingCode: '123456' })
        await expect(confirm.execute(confirmWith('000000'))).rejects.toBeInstanceOf(
            TfaCodeInvalidError,
        )
        expect(tfa.confirmPendingTfaMethod).not.toHaveBeenCalled()
    })

    // A restarted enrolment replaced the pending secret between the check and
    // the confirmation: the new secret was never proven.
    it('refuses when the checked secret is no longer the pending one', async () => {
        const { confirm, tfa, audit } = build({ validPendingCode: '123456' })
        tfa.confirmPendingTfaMethod.mockResolvedValue(false)
        await expect(confirm.execute(confirmWith('123456'))).rejects.toBeInstanceOf(
            TfaEnrollmentNotStartedError,
        )
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('refuses once an authenticator is confirmed', async () => {
        const { confirm } = build({ enrolled: true, validPendingCode: '123456' })
        await expect(confirm.execute(confirmWith('123456'))).rejects.toBeInstanceOf(
            TfaAlreadyEnabledError,
        )
    })

    it('refuses an account that is not a platform admin', async () => {
        const { confirm } = build({ validPendingCode: '123456' })
        await expect(
            confirm.execute(confirmWith('123456', member)),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
