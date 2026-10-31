import { compare } from 'bcrypt'

import { Feature, IFeatureHandler } from '@shelfjs/features'
import { PrismaService } from '../../infrastructure/prisma'
import { AuditService } from '../../domains/audit/services/audit.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import {
    UserNoCompleteCodeError,
    UserNotFoundError,
} from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { StoreReviewMembershipService } from '../../domains/workspace/services/store-review-membership.service'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import { hasPrivilegedAccess } from '../../shared/utils/store-review-access.util'
import {
    isStoreReviewEmail,
    storeReviewCodeMatches,
} from '../../shared/utils/store-review.util'
import {
    InvalidCredentialsError,
    SignInFeature,
    SignInFeatureResponse,
    TooManySignInAttemptsError,
} from './sign-in.feature'

// OTP lifetime — long enough for a slow inbox / SMS, short enough that
// a leaked code can't be redeemed later. 15 minutes is the industry
// default (Google, GitHub, AWS).
const CODE_TTL_MS = 15 * 60 * 1000

// After this many wrong codes against the same account we lock sign-in
// for LOCKOUT_MS. Issuing a fresh code resets the counter so a user
// who genuinely forgot the code can recover.
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

// Compared against on the store-review path so it spends the same bcrypt time
// as a normal account (which compares against its emailed code's hash).
const DUMMY_HASH = '$2b$10$4ztxPTDvmLpKogYQGru0BOvy.ePGpMHLJgUIb6t8KWBwUhjJ2QVXW'

type SignInUser = {
    id: string
    isSuperAdmin: boolean
    signInLockedUntil: Date | null
    completeCodeIssuedAt: Date | null
}

@Feature(SignInFeature)
export class SignInHandler
    implements IFeatureHandler<SignInFeature, SignInFeatureResponse>
{
    constructor(
        private readonly tokensService: TokensService,
        private readonly usersService: UsersService,
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly storeReviewMembership: StoreReviewMembershipService,
    ) {}

    async execute({ payload }: SignInFeature): Promise<SignInFeatureResponse> {
        const { email, code } = payload

        const user = await this.usersService.getUserByEmail({
            email,
        })

        if (!user) {
            throw new UserNotFoundError({ email })
        }

        // BLOCKED (banned) or DELETED (self-deleted, anonymized) — neither may
        // sign in. A DELETED row's email is scrubbed anyway, but guard in case.
        if (user.status === 'BLOCKED' || user.status === 'DELETED') {
            throw new UserBlockedError()
        }

        // Brute-force lockout — checked before bcrypt.compare so an
        // attacker can't keep burning CPU/timing-leak attempts during
        // the lockout window.
        if (
            user.signInLockedUntil &&
            user.signInLockedUntil.getTime() > Date.now()
        ) {
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }

        // Store-review account: fixed code instead of an emailed OTP. Sits
        // after the lockout check so wrong guesses still lock the account (and
        // the controller's per-IP throttle still applies).
        if (isStoreReviewEmail(email) && isStoreReviewEmail(user.email)) {
            return await this.signInStoreReview(user, code)
        }

        if (!user.completeCode) {
            throw new UserNoCompleteCodeError({ id: user.id })
        }

        // Code TTL — reject without bcrypt work if it's stale.
        if (this.isCodeStale(user)) {
            throw new InvalidCredentialsError()
        }

        await this.claimAttempt(user)

        const isCodeValid = await compare(code, user.completeCode)

        if (!isCodeValid) {
            return await this.recordFailedAttempt(user)
        }

        return await this.issueSession(user)
    }

    private async signInStoreReview(
        user: SignInUser,
        code: string,
    ): Promise<SignInFeatureResponse> {
        // Never let the fixed code open a real account. Refuse exactly like
        // a wrong code.
        if (await hasPrivilegedAccess(this.prisma, user)) {
            throw new InvalidCredentialsError()
        }

        // Like a normal account, it only signs in after a code was "requested"
        // (send-auth-code stamps completeCodeIssuedAt for this account).
        if (!user.completeCodeIssuedAt) {
            throw new UserNoCompleteCodeError({ id: user.id })
        }
        if (this.isCodeStale(user)) {
            throw new InvalidCredentialsError()
        }

        await this.claimAttempt(user)

        // Timing parity with a normal account; the result is not used.
        await compare(code, DUMMY_HASH)

        if (!storeReviewCodeMatches(code)) {
            return await this.recordFailedAttempt(user)
        }

        await this.audit.record({
            action: 'auth.storeReviewSignIn',
            targetType: 'member',
            targetId: user.id,
            actorId: user.id,
            workspaceId: null,
        })
        await this.storeReviewMembership.ensureDemoMembership(user.id)
        return await this.issueSession(user)
    }

    private isCodeStale(user: SignInUser): boolean {
        return (
            !!user.completeCodeIssuedAt &&
            Date.now() - user.completeCodeIssuedAt.getTime() > CODE_TTL_MS
        )
    }

    // Counts this attempt atomically BEFORE the code is compared. Deciding from
    // the row read at the top lets a burst of concurrent guesses all pass the
    // lock check and each write "n + 1" — the whole burst would count once.
    // The conditional increment hands out at most MAX_FAILED_ATTEMPTS tickets
    // between locks; when none is left the account gets locked.
    private async claimAttempt(user: SignInUser): Promise<void> {
        const claimed = await this.prisma.user.updateMany({
            where: {
                id: user.id,
                signInFailedAttempts: { lt: MAX_FAILED_ATTEMPTS },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: { signInFailedAttempts: { increment: 1 } },
        })
        if (claimed.count === 0) {
            await this.lockIfExhausted(user)
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }
    }

    // Starts the lockout (and zeroes the counter, so the account is fresh when
    // the lock expires) once every ticket is spent. Idempotent under races.
    private async lockIfExhausted(user: SignInUser): Promise<void> {
        await this.prisma.user.updateMany({
            where: {
                id: user.id,
                signInFailedAttempts: { gte: MAX_FAILED_ATTEMPTS },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: {
                signInFailedAttempts: 0,
                signInLockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }

    private async recordFailedAttempt(user: SignInUser): Promise<never> {
        // The attempt was already counted by claimAttempt; this only starts the
        // lockout when that was the last ticket.
        await this.lockIfExhausted(user)
        throw new InvalidCredentialsError()
    }

    private async issueSession(
        user: SignInUser,
    ): Promise<SignInFeatureResponse> {
        // Successful sign-in — burn the OTP so it can't be replayed and
        // reset brute-force state. (For the store-review account there is no
        // stored code; the write is a harmless no-op on those fields.)
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                completeCode: null,
                completeCodeIssuedAt: null,
                signInFailedAttempts: 0,
                signInLockedUntil: null,
            },
        })

        const accessToken = await this.tokensService.generateToken({
            userId: user.id,
        })

        const refreshToken = await this.tokensService.generateStoredToken({
            userId: user.id,
        })

        return {
            userId: user.id,
            accessToken,
            refreshToken,
            expiresAt:
                Math.floor(Date.now() / 1000) +
                this.tokensService.accessTokenTTL,
        }
    }
}
